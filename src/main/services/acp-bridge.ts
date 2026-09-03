import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import type { ClientConnection, SessionNotification } from '@agentclientprotocol/sdk'
import type {
  AcpSessionInfo,
  AcpSessionResult,
  AgentAdapterId,
  AgentCommand,
  AgentEffort,
  AgentModel,
  AgentMode,
  AgentState,
  ChatMessage,
  LoadedSession,
  PromptRequest
} from '../../shared/acp'
import { automationsFilePath } from './automation-store'
import { todosFilePath } from './todo-store'
import {
  attachmentResourceUri,
  importAttachment,
  readAttachment
} from './attachment-store'
import type { ChatAttachment } from '../../shared/attachments'
import { piAcpEnvironment } from './pi-runtime'
import type { QueuedPromptStore, StoredQueuedPrompt } from './queued-prompt-store'

const DIRECT_IMAGE_MIME_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])
const MAX_EMBEDDED_TEXT_BYTES = 2 * 1024 * 1024
/** 工具输出缓冲上限（超出保留尾部，避免超长输出拖垮渲染）。 */
const MAX_TOOL_OUTPUT_CHARS = 50_000

/** 工具调用的累积状态：tool_call / tool_call_update / terminal _meta 汇聚到一个条目。 */
interface ToolCallEntry {
  toolCallId: string
  title: string
  kind: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  /** content 块扁平化后的 markdown（tool_call_update 携带 content 时整体替换）。 */
  contentText: string
  /** terminal_output 累积的终端输出缓冲。 */
  terminal: string
  exitCode?: number
  elapsedSeconds?: number
  truncated: boolean
  createdAt: string
}

/** 适配器在 tool_call / tool_call_update._meta 上附加的扩展数据。 */
interface ToolCallMeta {
  terminal_output?: { terminal_id?: string; data?: string }
  terminal_exit?: { terminal_id?: string; exit_code?: number | null }
  claudeCode?: { toolResponse?: { elapsedTimeSeconds?: number } }
}

interface AcpBridgeOptions {
  initialAgentId?: AgentAdapterId
  getPreferredModeId?: () => Promise<string | undefined>
  setPreferredModeId?: (modeId: string) => Promise<void>
  getPreferredModelId?: () => Promise<string | undefined>
  setPreferredModelId?: (modelId: string) => Promise<void>
  getPreferredEffortId?: () => Promise<string | undefined>
  setPreferredEffortId?: (effortId: string) => Promise<void>
  getPreferredAgentId?: () => Promise<string | undefined>
  setPreferredAgentId?: (agentId: AgentAdapterId) => Promise<void>
  queuedPromptStore?: QueuedPromptStore
}

export class AcpBridge extends EventEmitter {
  private agentProcess?: ChildProcessWithoutNullStreams
  private connection?: ClientConnection
  private currentAgent: AgentAdapterId
  private agentPreferenceLoaded: boolean
  private state: AgentState
  private sessionCwd?: string
  private activeSessionId?: string
  private connectPromise?: Promise<AgentState>
  private connectingCwd?: string
  private connectingAgent?: AgentAdapterId
  private connectionGeneration = 0
  private permissionResolve?: (optionId: string | null) => void
  /** 标识当前 prompt，避免异步结束时清理了后续 prompt 的流式状态。 */
  private activePromptId?: string
  /** turn 生命周期代次；切换连接时让旧 turn 的 finally 失效。 */
  private turnGeneration = 0
  /** ACP 未提供 messageId 时，用于合并当前连续的助手消息分片。 */
  private fallbackAssistantMessageId?: string
  /** 当前 turn 的助手正文消息 id，turn 结束时据此写入 finishedAt（用于计算该轮总耗时）。 */
  private turnAssistantMessageId?: string
  /** session/load 中的无 ID 消息是完整历史消息，不能跨条合并。 */
  private replayingSession = false
  /** Pi ACP 的 session/new 响应会预告随后异步推送的启动信息。 */
  private suppressPiStartupInfo = false
  /** 当前 ACP 适配器是否支持 _session/steering（把消息注入正在进行的 turn）。 */
  private steeringSupported = false
  /** 本地 FIFO 队列：Agent 忙碌时的新消息先入队，当前 turn 结束后逐条处理。 */
  private promptQueue: StoredQueuedPrompt[] = []
  /** 当前会话的工具调用累积状态（toolCallId → 条目），切换会话时清空。 */
  private toolCalls = new Map<string, ToolCallEntry>()
  /** 会话切换操作代次；较早的 session/load 完成后不得覆盖最后一次选择。 */
  private sessionChangeGeneration = 0

  constructor(private readonly options: AcpBridgeOptions = {}) {
    super()
    this.currentAgent = options.initialAgentId ?? 'claude'
    this.agentPreferenceLoaded = options.initialAgentId !== undefined
    this.state = { status: 'disconnected', currentAgent: this.currentAgent }
  }

  private automationMcpServers(): acp.McpServer[] {
    return [{
      name: 'koala-automations',
      command: process.execPath,
      args: [join(__dirname, '../mcp/mcp/automations-server.js')],
      env: [
        { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
        { name: 'KOALA_AUTOMATIONS_FILE', value: automationsFilePath() },
        { name: 'KOALA_TODOS_FILE', value: todosFilePath() }
      ]
    }]
  }

  getState(): AgentState {
    return this.state
  }

  async getCurrentAgent(): Promise<AgentAdapterId> {
    if (!this.agentPreferenceLoaded) {
      const preferredAgentId = await this.options.getPreferredAgentId?.()
      if (preferredAgentId === 'claude' || preferredAgentId === 'pi') {
        this.currentAgent = preferredAgentId
      }
      this.agentPreferenceLoaded = true
      this.setState(this.state)
    }
    return this.currentAgent
  }

  async setAgent(agentId: AgentAdapterId): Promise<void> {
    if (agentId !== 'claude' && agentId !== 'pi') {
      throw new Error('不支持所选 Agent。')
    }
    if (agentId === await this.getCurrentAgent()) return

    await this.preserveAndDetachQueue('切换 Agent，排队消息已保留，切回原会话后会继续处理。')
    await this.options.setPreferredAgentId?.(agentId)
    this.dispose()
    this.currentAgent = agentId
    this.agentPreferenceLoaded = true
    this.setState({ status: 'disconnected' })
  }

  async connect(cwd: string): Promise<AgentState> {
    const agentId = await this.getCurrentAgent()
    // 同一目录已就绪则直接复用；切换工作目录时重启 ACP 适配器
    if ((this.state.status === 'ready' || this.state.status === 'working') && this.sessionCwd === cwd) {
      return this.state
    }
    if (this.connectPromise && this.connectingCwd === cwd && this.connectingAgent === agentId) {
      return this.connectPromise
    }
    if (this.agentProcess || this.connection || this.connectPromise) {
      await this.preserveAndDetachQueue('切换项目，排队消息已保留，返回原会话后会继续处理。')
      this.dispose()
    }
    // 防止并发触发多次连接（例如 React StrictMode 双调用）
    const generation = ++this.connectionGeneration
    this.connectingCwd = cwd
    this.connectingAgent = agentId
    const connectPromise = this.establishConnection(cwd, agentId, generation).finally(() => {
      if (this.connectPromise === connectPromise) {
        this.connectPromise = undefined
        this.connectingCwd = undefined
        this.connectingAgent = undefined
      }
    })
    this.connectPromise = connectPromise
    return connectPromise
  }

  private async establishConnection(cwd: string, agentId: AgentAdapterId, generation: number): Promise<AgentState> {
    const agentName = agentId === 'pi' ? 'Pi' : 'Claude'
    this.setState({ status: 'connecting', detail: `正在启动 ${agentName} ACP 适配器…` })

    try {
      const adapterPath = agentId === 'pi'
        ? require.resolve('pi-acp/dist/index.js')
        : require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
      const agentProcess = spawn(process.execPath, [adapterPath], {
        cwd,
        env: agentId === 'pi'
          ? piAcpEnvironment()
          : { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      this.agentProcess = agentProcess
      // 子进程异常退出后仍可能收到一次写入（如关闭通知），未监听会变成未捕获的 EPIPE 异常。
      agentProcess.on('error', () => undefined)
      agentProcess.stdin.on('error', () => undefined)
      agentProcess.stderr.on('data', (buffer: Buffer) => {
        if (this.agentProcess !== agentProcess) return
        const detail = buffer.toString().trim()
        if (detail) this.emit('message', this.systemMessage(detail))
      })
      agentProcess.once('exit', (code) => {
        // 切换项目会主动终止旧进程；旧进程的延迟 exit 不能覆盖新连接的状态。
        if (this.agentProcess !== agentProcess) return
        if (this.state.status !== 'disconnected') {
          this.setState({ status: 'error', detail: `ACP 服务已退出（代码 ${code ?? '未知'}）。` })
        }
      })

      const stream = acp.ndJsonStream(
        Writable.toWeb(agentProcess.stdin) as WritableStream<Uint8Array>,
        Readable.toWeb(agentProcess.stdout) as ReadableStream<Uint8Array>
      )
      const client = acp
        .client({ name: 'Koala Studio' })
        .onRequest(acp.methods.client.session.requestPermission, (context) => this.handlePermissionRequest(context.params))
        .onNotification(acp.methods.client.session.update, (context) => this.handleSessionUpdate(context.params))

      this.connection = client.connect(stream)
      const connection = this.connection
      const initializeResponse = await connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        // _meta.terminal_output：声明后两个适配器的 bash 输出统一走 _meta.terminal_output，
        // 并附带 terminal_exit 退出码（SDK 的 ClientCapabilities 类型尚未收录 _meta）。
        clientCapabilities: {
          session: { configOptions: { boolean: {} } },
          _meta: { terminal_output: true }
        } as acp.ClientCapabilities
      })
      // 读取 ACP 引导扩展能力：claude-agent-acp 会在 _meta.steering.supported 广告。
      const steeringMeta = (initializeResponse as unknown as { _meta?: { steering?: { supported?: boolean } } })?._meta?.steering
      this.steeringSupported = Boolean(steeringMeta?.supported)
      if (generation !== this.connectionGeneration || this.agentProcess !== agentProcess) {
        connection.close()
        agentProcess.kill()
        return this.state
      }
      this.sessionCwd = cwd
      this.setState({ status: 'ready', detail: `${agentName} 已连接`, steeringSupported: this.steeringSupported })
      this.emit('message', this.systemMessage(`已连接 ${agentName} ACP。`))
    } catch (error) {
      if (generation === this.connectionGeneration) {
        this.dispose()
        this.setState({ status: 'error', detail: error instanceof Error ? error.message : `无法连接 ${agentName} ACP。` })
      }
    }

    return this.state
  }

  /** 通过 ACP session/list 查询 Claude Code 在该目录下的会话记录。 */
  async listSessions(cwd: string): Promise<AcpSessionInfo[]> {
    const state = await this.connect(cwd)
    if ((state.status !== 'ready' && state.status !== 'working') || !this.connection) return []
    const response = await this.connection.agent.request(acp.methods.agent.session.list, { cwd })
    return (response.sessions ?? []).map((session) => ({
      sessionId: session.sessionId,
      title: session.title ?? '',
      updatedAt: session.updatedAt ?? '',
      cwd: session.cwd
    }))
  }

  /** 通过 ACP session/load 加载历史会话，回放消息通过 onMessage 事件流式推送到 UI。 */
  async loadSession(sessionId: string, cwd: string): Promise<LoadedSession> {
    if (!this.connection) throw new Error('请先连接 Agent ACP。')

    await this.prepareForSessionChange()
    const sessionChangeGeneration = this.sessionChangeGeneration
    this.activeSessionId = sessionId
    this.sessionCwd = cwd

    this.replayingSession = true
    const response = await this.connection.agent.request(acp.methods.agent.session.load, {
      sessionId,
      cwd,
      mcpServers: this.automationMcpServers()
    }).finally(() => {
      // 并发加载时，较早请求的 finally 不能结束较新会话的回放状态。
      if (sessionChangeGeneration === this.sessionChangeGeneration) this.replayingSession = false
    })

    // 用户在加载期间又切换了会话；丢弃这次加载的状态更新。
    if (sessionChangeGeneration !== this.sessionChangeGeneration || this.activeSessionId !== sessionId) {
      return { sessionId, messages: [] }
    }

    const modes = this.toAgentModes(response.modes)
    const model = this.toAgentModel(response.configOptions)
    const effort = this.toAgentEffort(response.configOptions)
    const currentModeId = await this.restorePreferredMode(modes, response.modes?.currentModeId)

    this.setState({
      ...this.state,
      sessionId,
      modes,
      currentModeId,
      model,
      effort,
      commands: undefined,
      usage: undefined
    })

    await this.restorePreferredModel(this.state.model)
    await this.restorePreferredEffort(this.state.effort)
    await this.restoreQueue()
    void this.startQueuedIfIdle()

    return { sessionId, messages: [], modes, currentModeId }
  }

  private toAgentCommands(commands: acp.AvailableCommand[] | undefined): AgentCommand[] | undefined {
    return commands?.map((command) => ({
      name: command.name,
      description: command.description,
      hint: command.input?.hint ?? undefined
    }))
  }

  /** 通过 ACP session/new 新建会话并设为当前会话。 */
  async createSession(cwd: string): Promise<AcpSessionResult> {
    if (!this.connection) throw new Error('请先连接 Agent ACP。')
    await this.prepareForSessionChange()
    const sessionChangeGeneration = this.sessionChangeGeneration
    this.suppressPiStartupInfo = false
    const response = await this.connection.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: this.automationMcpServers() })
    if (sessionChangeGeneration !== this.sessionChangeGeneration) {
      return { sessionId: response.sessionId }
    }
    const startupInfo = (response._meta as { piAcp?: { startupInfo?: unknown } } | undefined)?.piAcp?.startupInfo
    this.suppressPiStartupInfo = this.currentAgent === 'pi' && typeof startupInfo === 'string' && startupInfo.length > 0
    this.activeSessionId = response.sessionId
    this.sessionCwd = cwd
    const modes = this.toAgentModes(response.modes)
    const model = this.toAgentModel(response.configOptions)
    const effort = this.toAgentEffort(response.configOptions)
    const currentModeId = await this.restorePreferredMode(modes, response.modes?.currentModeId)
    this.setState({ ...this.state, sessionId: response.sessionId, modes, currentModeId, model, effort, usage: undefined })
    await this.restorePreferredModel(this.state.model)
    await this.restorePreferredEffort(this.state.effort)
    await this.restoreQueue()
    return { sessionId: response.sessionId, modes, currentModeId }
  }

  async prompt(request: PromptRequest): Promise<void> {
    if (!this.activeSessionId || !this.connection) {
      throw new Error('请先连接 Agent ACP。')
    }
    if (this.state.status !== 'ready' && this.state.status !== 'working') {
      throw new Error('请先连接 Agent ACP。')
    }

    // Agent 忙碌时先留在输入框上方的本地队列；真正执行或调整方向时再写入对话。
    if (this.state.status === 'working') {
      await this.enqueuePrompt(request)
      return
    }

    // 空闲：立即作为新一轮任务提交。
    this.emitUserMessage(request)
    await this.runTurn(request)
  }

  async removeQueuedPrompt(id: string): Promise<void> {
    const index = this.promptQueue.findIndex((item) => item.id === id)
    if (index < 0) return
    const previous = [...this.promptQueue]
    this.promptQueue.splice(index, 1)
    try {
      await this.persistQueue()
    } catch (error) {
      this.promptQueue = previous
      throw error
    }
    this.updateQueueState()
  }

  async steerQueuedPrompt(id: string): Promise<void> {
    const index = this.promptQueue.findIndex((item) => item.id === id)
    if (index < 0) return
    const [queued] = this.promptQueue.splice(index, 1)
    if (!queued) return
    try {
      await this.persistQueue()
    } catch (error) {
      this.promptQueue.splice(index, 0, queued)
      throw error
    }
    this.updateQueueState()
    this.emitUserMessage(queued.request)
    queued.displayed = true

    if (this.state.status !== 'working') {
      void this.runTurn(queued.request)
      return
    }

    if (this.steeringSupported) {
      const outcome = await this.trySteer(queued.request)
      if (outcome === 'injected') return
      if (outcome === 'promptRequired') {
        this.promptQueue.unshift(queued)
        try {
          await this.persistQueue()
        } catch {
          this.promptQueue.shift()
          this.updateQueueState()
          await this.interruptAndRun(queued.request)
          return
        }
        this.updateQueueState()
        void this.startQueuedIfIdle()
        return
      }
    }

    await this.interruptAndRun(queued.request)
  }

  private emitUserMessage(request: PromptRequest): void {
    this.emit('message', {
      id: crypto.randomUUID(),
      role: 'user',
      content: request.text,
      attachments: request.attachments,
      createdAt: new Date().toISOString()
    } satisfies ChatMessage)
  }

  /** 提交一轮完整任务（构造 prompt → session/prompt → 工具循环 → 直至模型产出）。 */
  private async runTurn(request: PromptRequest): Promise<void> {
    const promptId = crypto.randomUUID()
    const turnGeneration = this.turnGeneration
    const connection = this.connection
    const sessionId = this.activeSessionId
    if (!connection || !sessionId) return
    const agentName = this.currentAgent === 'pi' ? 'Pi' : 'Claude'
    this.setState({
      ...this.state,
      status: 'working',
      workStartedAt: Date.now(),
      lastTurnSeconds: undefined,
      queueDepth: this.promptQueue.length,
      queuedPrompts: this.queueState(),
      detail: `${agentName} 正在处理…`
    })

    try {
      this.activePromptId = promptId
      const prompt = await this.toPromptContent(request)
      this.fallbackAssistantMessageId = crypto.randomUUID()
      this.turnAssistantMessageId = undefined
      await connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt
      })
    } catch (error) {
      if (turnGeneration === this.turnGeneration) {
        this.emit('message', this.systemMessage(error instanceof Error ? error.message : `${agentName} 未能完成请求。`))
      }
    } finally {
      if (this.activePromptId === promptId) {
        this.activePromptId = undefined
        this.fallbackAssistantMessageId = undefined
      }
      if (turnGeneration === this.turnGeneration && this.activeSessionId === sessionId) {
        void this.finishTurn()
      }
    }
  }

  /** 解析当前 turn 的执行秒数：无活跃 turn 时沿用上次结果，避免停止/切换时把摘要清掉。 */
  private computeTurnSeconds(): number | undefined {
    if (this.state.workStartedAt == null) return this.state.lastTurnSeconds
    return Math.max(0, Math.round((Date.now() - this.state.workStartedAt) / 1000))
  }

  /** 当前 turn 结束后：若还有排队消息则继续下一轮，否则恢复就绪。 */
  private async finishTurn(): Promise<void> {
    // 给本轮助手正文打上结束时间，渲染层据此计算「用户发送 time → 回复结束」的总耗时。
    const assistantId = this.turnAssistantMessageId
    this.turnAssistantMessageId = undefined
    if (assistantId) {
      this.emit('message', {
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        finishedAt: new Date().toISOString()
      } satisfies ChatMessage)
    }
    // 中断的 turn 可能没等到适配器的终态更新，先兜底收尾工具调用展示。
    this.finalizeToolCalls()
    const next = this.promptQueue.shift()
    if (next) {
      try {
        await this.persistQueue()
      } catch (error) {
        this.promptQueue.unshift(next)
        this.updateQueueState()
        this.setState({ ...this.state, status: 'ready', workStartedAt: undefined, detail: '排队消息保存失败，已暂停自动发送。' })
        this.emit('message', this.systemMessage(error instanceof Error ? error.message : '无法保存排队消息。'))
        return
      }
      this.updateQueueState()
      if (!next.displayed) this.emitUserMessage(next.request)
      void this.runTurn(next.request)
      return
    }
    const agentName = this.currentAgent === 'pi' ? 'Pi' : 'Claude'
    this.setState({
      ...this.state,
      status: 'ready',
      workStartedAt: undefined,
      lastTurnSeconds: this.computeTurnSeconds(),
      queueDepth: 0,
      queuedPrompts: [],
      detail: `${agentName} 已就绪`
    })
  }

  /** 把消息放入本地 FIFO 队列，当前 turn 结束后按先进先出处理。 */
  private async enqueuePrompt(request: PromptRequest): Promise<void> {
    const queued = { id: crypto.randomUUID(), request }
    this.promptQueue.push(queued)
    try {
      await this.persistQueue()
    } catch (error) {
      this.promptQueue = this.promptQueue.filter((item) => item.id !== queued.id)
      throw error
    }
    this.updateQueueState()
    // 竞态兜底：如果此刻已没有活跃 turn（turn 刚好结束），立即启动处理，避免消息悬挂在队列里。
    void this.startQueuedIfIdle()
  }

  /** 若没有活跃 turn 且队列非空，立即启动排队的下一条消息。 */
  private async startQueuedIfIdle(): Promise<void> {
    if (this.state.status === 'working') return
    const next = this.promptQueue.shift()
    if (!next) return
    try {
      await this.persistQueue()
    } catch (error) {
      this.promptQueue.unshift(next)
      this.updateQueueState()
      this.emit('message', this.systemMessage(error instanceof Error ? error.message : '无法保存排队消息。'))
      return
    }
    this.updateQueueState()
    if (!next.displayed) this.emitUserMessage(next.request)
    void this.runTurn(next.request)
  }

  private queueState(): AgentState['queuedPrompts'] {
    return this.promptQueue.map(({ id, request }) => ({
      id,
      text: request.text,
      attachmentNames: request.attachments?.map((attachment) => attachment.name) ?? []
    }))
  }

  private updateQueueState(): void {
    this.setState({
      ...this.state,
      queueDepth: this.promptQueue.length,
      queuedPrompts: this.queueState()
    })
  }

  private async persistQueue(): Promise<void> {
    if (!this.options.queuedPromptStore || !this.activeSessionId || !this.sessionCwd) return
    await this.options.queuedPromptStore.replace(
      this.currentAgent,
      this.sessionCwd,
      this.activeSessionId,
      this.promptQueue
    )
  }

  private async restoreQueue(): Promise<void> {
    if (!this.options.queuedPromptStore || !this.activeSessionId || !this.sessionCwd) {
      this.promptQueue = []
    } else {
      this.promptQueue = await this.options.queuedPromptStore.get(this.currentAgent, this.sessionCwd, this.activeSessionId)
    }
    this.updateQueueState()
  }

  private async preserveAndDetachQueue(notify?: string): Promise<void> {
    const preserved = this.promptQueue.length
    if (preserved > 0) await this.persistQueue()
    this.promptQueue = []
    if (notify && preserved > 0) this.emit('message', this.systemMessage(`${notify}（共 ${preserved} 条）。`))
    this.updateQueueState()
  }

  /**
   * 切换会话时只隔离当前 UI 路由，不终止旧 turn。
   *
   * ACP 连接可以同时承载多个 session。切换历史会话不应影响原会话的
   * 后台生成；旧 session 的通知会因 activeSessionId 检查被暂时忽略，
   * 用户切回时仍可通过 session/load 看到完整结果。
   */
  private async prepareForSessionChange(): Promise<void> {
    this.sessionChangeGeneration += 1
    await this.preserveAndDetachQueue('切换会话，排队消息已保留，返回后会继续处理。')
    // 工具调用状态属于上一个会话，切换后按新会话重新累积。
    this.toolCalls.clear()
    // 让旧 turn 的 finally 不得改写新会话状态，但不要 cancel 旧 session。
    // 这样切换会话不会中断原本正在执行的请求。
    this.turnGeneration += 1
    this.activePromptId = undefined
    this.fallbackAssistantMessageId = undefined
    const agentName = this.currentAgent === 'pi' ? 'Pi' : 'Claude'
    this.setState({ ...this.state, status: 'ready', workStartedAt: undefined, lastTurnSeconds: undefined, queueDepth: 0, queuedPrompts: [], detail: `${agentName} 已就绪` })
  }

  /** 主动停止时清空当前会话的排队消息，并同步删除持久化记录。 */
  private async resetQueue(notify?: string): Promise<void> {
    const cleared = this.promptQueue.length
    const previous = [...this.promptQueue]
    this.promptQueue = []
    try {
      await this.persistQueue()
    } catch (error) {
      this.promptQueue = previous
      this.updateQueueState()
      throw error
    }
    if (notify && cleared > 0) this.emit('message', this.systemMessage(`${notify}（共 ${cleared} 条）。`))
    this.updateQueueState()
  }

  private async interruptAndRun(request: PromptRequest): Promise<void> {
    const connection = this.connection
    const sessionId = this.activeSessionId
    if (!connection || !sessionId) return
    this.turnGeneration += 1
    this.activePromptId = undefined
    this.fallbackAssistantMessageId = undefined
    this.setState({ ...this.state, status: 'working', detail: '正在调整任务方向…' })
    await connection.agent.notify(acp.methods.agent.session.cancel, { sessionId })
    void this.runTurn(request)
  }

  /**
   * 通过 ACP 的 _session/steering 扩展协议，把消息注入到正在进行的 turn 中。
   * 返回 injected（已注入） / promptRequired（无活跃 turn，需降级） / failed（失败）。
   */
  private async trySteer(request: PromptRequest): Promise<'injected' | 'promptRequired' | 'failed'> {
    const connection = this.connection
    const sessionId = this.activeSessionId
    if (!connection || !sessionId) return 'failed'
    try {
      const prompt = await this.toPromptContent(request)
      const response = await connection.agent.request(
        '_session/steering',
        { sessionId, prompt, _meta: { steering: { idleBehavior: 'promptRequired' as const } } }
      ) as { outcome?: string }
      if (response?.outcome === 'injected') return 'injected'
      if (response?.outcome === 'promptRequired') {
        return 'promptRequired'
      }
      return 'failed'
    } catch {
      return 'failed'
    }
  }

  async stop(): Promise<void> {
    if (this.promptQueue.length > 0) {
      await this.resetQueue('已清除排队消息')
    }
    if (this.connection && this.activeSessionId) {
      const stoppingPromptId = this.activePromptId
      if (stoppingPromptId) {
        this.setState({ ...this.state, status: 'working', queueDepth: 0, queuedPrompts: [], detail: '正在停止当前任务…' })
      }
      await this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.activeSessionId })
      if (!stoppingPromptId || this.activePromptId !== stoppingPromptId) {
        this.setState({ ...this.state, status: 'ready', workStartedAt: undefined, lastTurnSeconds: this.computeTurnSeconds(), queueDepth: 0, queuedPrompts: [], detail: '已停止生成' })
      }
    }
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.connection || !this.activeSessionId) {
      throw new Error('请先连接 Agent ACP。')
    }
    await this.connection.agent.request(acp.methods.agent.session.setMode, {
      sessionId: this.activeSessionId,
      modeId
    })
    this.setState({ ...this.state, currentModeId: modeId })
    await this.options.setPreferredModeId?.(modeId)
  }

  async setModel(modelId: string): Promise<void> {
    if (!this.connection || !this.activeSessionId || !this.state.model) {
      throw new Error('当前会话不支持切换模型。')
    }
    if (!this.state.model.options.some((option) => option.value === modelId)) {
      throw new Error('所选模型不在当前会话的可用列表中。')
    }

    const response = await this.connection.agent.request(acp.methods.agent.session.setConfigOption, {
      sessionId: this.activeSessionId,
      configId: this.state.model.configId,
      value: modelId
    })
    this.setState({ ...this.state, model: this.toAgentModel(response.configOptions), effort: this.toAgentEffort(response.configOptions) })
    await this.options.setPreferredModelId?.(modelId)
  }

  private async restorePreferredModel(model: AgentModel | undefined): Promise<void> {
    if (!model || !this.connection || !this.activeSessionId) return
    const preferredModelId = await this.options.getPreferredModelId?.()
    if (!preferredModelId || preferredModelId === model.currentValue) return
    if (!model.options.some((option) => option.value === preferredModelId)) return

    const response = await this.connection.agent.request(acp.methods.agent.session.setConfigOption, {
      sessionId: this.activeSessionId,
      configId: model.configId,
      value: preferredModelId
    })
    const restoredModel = this.toAgentModel(response.configOptions)
    this.setState({ ...this.state, model: restoredModel })
  }

  private async restorePreferredEffort(effort: AgentEffort | undefined): Promise<void> {
    if (!effort || !this.connection || !this.activeSessionId) return
    const preferredEffortId = await this.options.getPreferredEffortId?.()
    if (!preferredEffortId || preferredEffortId === effort.currentValue) return
    if (!effort.options.some((option) => option.value === preferredEffortId)) return

    const response = await this.connection.agent.request(acp.methods.agent.session.setConfigOption, {
      sessionId: this.activeSessionId,
      configId: effort.configId,
      value: preferredEffortId
    })
    this.setState({ ...this.state, effort: this.toAgentEffort(response.configOptions) })
  }

  async setEffort(effortId: string): Promise<void> {
    if (!this.connection || !this.activeSessionId || !this.state.effort) {
      throw new Error('当前会话不支持切换推理强度。')
    }
    if (!this.state.effort.options.some((option) => option.value === effortId)) {
      throw new Error('所选推理强度不在当前会话的可用列表中。')
    }

    const response = await this.connection.agent.request(acp.methods.agent.session.setConfigOption, {
      sessionId: this.activeSessionId,
      configId: this.state.effort.configId,
      value: effortId
    })
    this.setState({ ...this.state, effort: this.toAgentEffort(response.configOptions) })
    await this.options.setPreferredEffortId?.(effortId)
  }

  private async restorePreferredMode(
    modes: AgentMode[] | undefined,
    currentModeId: string | undefined
  ): Promise<string | undefined> {
    const preferredModeId = await this.options.getPreferredModeId?.()
    if (
      !preferredModeId ||
      preferredModeId === currentModeId ||
      !modes?.some((mode) => mode.id === preferredModeId) ||
      !this.connection ||
      !this.activeSessionId
    ) {
      return currentModeId
    }

    await this.connection.agent.request(acp.methods.agent.session.setMode, {
      sessionId: this.activeSessionId,
      modeId: preferredModeId
    })
    return preferredModeId
  }

  respondPermission(optionId: string): void {
    this.permissionResolve?.(optionId)
    this.permissionResolve = undefined
  }

  private handlePermissionRequest(params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    // Cancel any previously pending request that was never answered
    this.permissionResolve?.(null)

    return new Promise<acp.RequestPermissionResponse>((resolve) => {
      this.permissionResolve = (optionId) => {
        this.setState({ ...this.state, pendingPermission: undefined })
        if (optionId === null) {
          resolve({ outcome: { outcome: 'cancelled' } })
        } else {
          resolve({ outcome: { outcome: 'selected', optionId } })
        }
      }

      this.setState({
        ...this.state,
        pendingPermission: {
          toolTitle: params.toolCall.title ?? undefined,
          options: params.options.map((option) => ({
            optionId: option.optionId,
            name: option.name,
            kind: option.kind
          }))
        }
      })
    })
  }

  dispose(): void {
    this.connectionGeneration += 1
    this.turnGeneration += 1
    this.sessionChangeGeneration += 1
    this.activeSessionId = undefined
    this.sessionCwd = undefined
    this.activePromptId = undefined
    this.fallbackAssistantMessageId = undefined
    this.replayingSession = false
    this.suppressPiStartupInfo = false
    this.promptQueue = []
    this.toolCalls.clear()
    this.steeringSupported = false
    this.connection?.close()
    this.agentProcess?.kill()
    this.connection = undefined
    this.agentProcess = undefined
    this.permissionResolve?.(null)
    this.permissionResolve = undefined
    if (this.state.status !== 'error') this.setState({ status: 'disconnected' })
  }

  /** 把 ACP 的 session/update 通知路由到当前会话。 */
  private handleSessionUpdate(notification: SessionNotification): void {
    if (!this.activeSessionId || notification.sessionId !== this.activeSessionId) return
    const update = notification.update
    if (update.sessionUpdate === 'usage_update') {
      this.setState({ ...this.state, usage: { used: update.used, size: update.size } })
      return
    }
    if (update.sessionUpdate === 'available_commands_update') {
      this.setState({ ...this.state, commands: this.toAgentCommands(update.availableCommands) })
      return
    }
    if (update.sessionUpdate === 'current_mode_update') {
      this.setState({ ...this.state, currentModeId: update.currentModeId })
      return
    }
    if (update.sessionUpdate === 'config_option_update') {
      this.setState({ ...this.state, model: this.toAgentModel(update.configOptions) })
      return
    }
    if (this.suppressPiStartupInfo && update.sessionUpdate === 'agent_message_chunk') {
      this.suppressPiStartupInfo = false
      return
    }
    if (update.sessionUpdate === 'user_message_chunk') {
      if (update.content.type === 'text') {
        this.emit('message', {
          id: update.messageId ?? crypto.randomUUID(),
          role: 'user',
          kind: 'text',
          content: update.content.text,
          createdAt: new Date().toISOString()
        } satisfies ChatMessage)
      } else if (update.content.type === 'image') {
        // 回放历史会话时，用户消息中的图片会以 image 块送达；存到本地附件后
        // 以同一 messageId 发消息，由渲染层与同 id 的文本合并成一条用户气泡。
        const messageId = update.messageId ?? crypto.randomUUID()
        void this.storeImageContent(update.content).then((attachment) => {
          this.emit('message', {
            id: messageId,
            role: 'user',
            kind: 'text',
            content: '',
            attachments: [attachment],
            createdAt: new Date().toISOString()
          } satisfies ChatMessage)
        }).catch((error: unknown) => {
          this.emit('message', this.systemMessage(error instanceof Error ? error.message : '无法保存历史会话中的图片。'))
        })
      }
      return
    }
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      const messageId = this.assistantMessageId(update.messageId)
      if (!this.replayingSession) this.turnAssistantMessageId = messageId
      this.emit('message', {
        id: messageId,
        role: 'assistant',
        kind: 'text',
        content: update.content.text,
        createdAt: new Date().toISOString()
      } satisfies ChatMessage)
    } else if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'image') {
      const messageId = this.assistantMessageId(update.messageId)
      void this.storeImageContent(update.content).then((attachment) => {
        this.emit('message', {
          id: messageId,
          role: 'assistant',
          kind: 'text',
          content: '',
          attachments: [attachment],
          createdAt: new Date().toISOString()
        } satisfies ChatMessage)
      }).catch((error: unknown) => {
        this.emit('message', this.systemMessage(error instanceof Error ? error.message : '无法保存 Claude 返回的图片。'))
      })
    } else if (update.sessionUpdate === 'agent_thought_chunk' && update.content.type === 'text') {
      this.emit('message', {
        id: `${this.assistantMessageId(update.messageId)}:thinking`,
        role: 'assistant',
        kind: 'thinking',
        content: update.content.text,
        createdAt: new Date().toISOString()
      } satisfies ChatMessage)
    } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      // Pi 不提供 messageId；工具后的正文必须另起一条，不能回填到工具前的消息。
      if (update.sessionUpdate === 'tool_call' && this.activePromptId) this.fallbackAssistantMessageId = crypto.randomUUID()
      const entry = this.upsertToolCall(update)
      this.applyToolCallMeta(entry, update._meta as ToolCallMeta | undefined)
      this.emitToolMessage(entry)
    }
  }

  private assistantMessageId(messageId: string | null | undefined): string {
    if (messageId) return messageId
    if (this.replayingSession) return crypto.randomUUID()
    if (!this.activePromptId) return crypto.randomUUID()
    this.fallbackAssistantMessageId ??= crypto.randomUUID()
    return this.fallbackAssistantMessageId
  }

  /** tool_call / tool_call_update 汇入累积条目；update 先于 tool_call 到达时自建条目（防御回放乱序）。 */
  private upsertToolCall(update: acp.ToolCall | acp.ToolCallUpdate): ToolCallEntry {
    let entry = this.toolCalls.get(update.toolCallId)
    if (!entry) {
      entry = {
        toolCallId: update.toolCallId,
        title: update.title ?? '工具',
        kind: update.kind ?? 'other',
        status: 'pending',
        contentText: '',
        terminal: '',
        truncated: false,
        createdAt: new Date().toISOString()
      }
      this.toolCalls.set(update.toolCallId, entry)
    }
    if (update.title) entry.title = update.title
    if (update.kind) entry.kind = update.kind
    if (update.status) entry.status = update.status
    // content 按协议语义整体替换
    if (update.content) entry.contentText = this.flattenToolContent(update.content)
    return entry
  }

  /** 应用适配器在 _meta 上附加的终端输出 / 退出码 / 耗时心跳。 */
  private applyToolCallMeta(entry: ToolCallEntry, meta: ToolCallMeta | undefined): void {
    if (!meta) return
    const output = meta.terminal_output?.data
    if (typeof output === 'string' && output.length > 0) {
      // claude 完成时一次性全量推送（替换）；pi 执行中按增量推送（追加）。
      entry.terminal = this.currentAgent === 'claude' ? output : entry.terminal + output
      if (entry.terminal.length > MAX_TOOL_OUTPUT_CHARS) {
        entry.terminal = entry.terminal.slice(-MAX_TOOL_OUTPUT_CHARS)
        entry.truncated = true
      }
    }
    const exitCode = meta.terminal_exit?.exit_code
    if (typeof exitCode === 'number') entry.exitCode = exitCode
    const elapsed = meta.claudeCode?.toolResponse?.elapsedTimeSeconds
    if (typeof elapsed === 'number') entry.elapsedSeconds = elapsed
  }

  /** 把 ACP 工具内容块扁平化为 markdown：文本原样、diff 转围栏；terminal 块无正文（输出走 _meta）。 */
  private flattenToolContent(content: acp.ToolCallContent[]): string {
    const parts: string[] = []
    for (const block of content) {
      if (block.type === 'content' && block.content.type === 'text') {
        parts.push(block.content.text)
      } else if (block.type === 'diff') {
        parts.push(this.renderDiffBlock(block))
      }
    }
    return parts.join('\n\n')
  }

  /** diff 块转 +/- 行的 diff 围栏，交给 MarkdownMessage 着色渲染。 */
  private renderDiffBlock(block: { path: string; oldText?: string | null; newText: string }): string {
    const removed = (block.oldText ?? '').split('\n').filter((line) => line.length > 0).map((line) => `- ${line}`)
    const added = block.newText.split('\n').map((line) => `+ ${line}`)
    return ['```diff', `--- ${block.path}`, `+++ ${block.path}`, ...removed, ...added, '```'].join('\n')
  }

  /** 发送工具调用的全量快照消息；id 稳定为 tool:{toolCallId}，renderer 按 id 整体替换。 */
  private emitToolMessage(entry: ToolCallEntry): void {
    const parts: string[] = []
    if (entry.truncated) parts.push('> 输出过长，仅保留末尾部分。')
    if (entry.contentText) parts.push(entry.contentText)
    // 四反引号围栏，避免终端输出内含 ``` 时提前闭合
    if (entry.terminal) parts.push(['````', entry.terminal, '````'].join('\n'))
    this.emit('message', {
      id: `tool:${entry.toolCallId}`,
      role: 'system',
      kind: 'tool',
      title: entry.title,
      content: parts.join('\n\n'),
      toolStatus: entry.status,
      toolKind: entry.kind,
      ...(entry.exitCode !== undefined ? { exitCode: entry.exitCode } : {}),
      ...(entry.elapsedSeconds !== undefined ? { elapsedSeconds: entry.elapsedSeconds } : {}),
      outputTruncated: entry.truncated || undefined,
      createdAt: entry.createdAt
    } satisfies ChatMessage)
  }

  /** turn 结束时给仍未收到终态的工具调用补一个完成快照，避免界面停留加载状态。 */
  private finalizeToolCalls(): void {
    for (const entry of this.toolCalls.values()) {
      if (entry.status === 'pending' || entry.status === 'in_progress') {
        entry.status = 'completed'
        this.emitToolMessage(entry)
      }
    }
  }

  private setState(state: AgentState): void {
    this.state = { ...state, currentAgent: this.currentAgent }
    this.emit('state', this.state)
  }

  private systemMessage(content: string): ChatMessage {
    return { id: crypto.randomUUID(), role: 'system', content, createdAt: new Date().toISOString() }
  }

  private async toPromptContent(request: PromptRequest): Promise<acp.ContentBlock[]> {
    const prompt: acp.ContentBlock[] = []
    if (request.text.trim()) prompt.push({ type: 'text', text: request.text })

    for (const attachment of request.attachments ?? []) {
      const data = await readAttachment(attachment)
      const uri = attachmentResourceUri(attachment)
      if (attachment.kind === 'image' && DIRECT_IMAGE_MIME_TYPES.has(attachment.mimeType)) {
        prompt.push({ type: 'image', data: data.toString('base64'), mimeType: attachment.mimeType, uri })
      } else if (attachment.kind === 'text' && data.length <= MAX_EMBEDDED_TEXT_BYTES) {
        prompt.push({
          type: 'resource',
          resource: { uri, mimeType: attachment.mimeType, text: data.toString('utf8') }
        })
      } else {
        prompt.push({
          type: 'resource_link',
          uri,
          name: attachment.name,
          mimeType: attachment.mimeType,
          size: attachment.size
        })
      }
    }

    if (prompt.length === 0) throw new Error('请输入内容或添加附件。')
    return prompt
  }

  private async storeImageContent(content: acp.ImageContent): Promise<ChatAttachment> {
    if (!content.data) throw new Error('图片内容为空，无法保存。')
    const extension = content.mimeType === 'image/jpeg' ? 'jpg' : content.mimeType.split('/')[1]?.split('+')[0] || 'png'
    return importAttachment({
      name: `conversation-image.${extension}`,
      mimeType: content.mimeType,
      data: new Uint8Array(Buffer.from(content.data, 'base64'))
    })
  }

  private toAgentModes(modes: acp.SessionModeState | null | undefined): AgentMode[] | undefined {
    return modes?.availableModes.map((mode) => ({ id: mode.id, name: mode.name, description: mode.description ?? undefined }))
  }

  private toAgentModel(configOptions: acp.SessionConfigOption[] | null | undefined): AgentModel | undefined {
    const option = configOptions?.find((candidate) => candidate.category === 'model' && candidate.type === 'select')
    if (!option || option.type !== 'select') return undefined

    const options = option.options.flatMap((item) => ('options' in item ? item.options : [item]))
    return {
      configId: option.id,
      name: option.name,
      currentValue: option.currentValue,
      options: options.map((model) => ({
        value: model.value,
        name: model.name,
        description: model.description ?? undefined
      }))
    }
  }

  private toAgentEffort(configOptions: acp.SessionConfigOption[] | null | undefined): AgentEffort | undefined {
    const option = configOptions?.find((candidate) => candidate.category === 'thought_level' && candidate.type === 'select')
    if (!option || option.type !== 'select') return undefined

    const options = option.options.flatMap((item) => ('options' in item ? item.options : [item]))
    return {
      configId: option.id,
      name: option.name,
      currentValue: option.currentValue,
      options: options.map((o) => ({ value: o.value, name: o.name }))
    }
  }
}
