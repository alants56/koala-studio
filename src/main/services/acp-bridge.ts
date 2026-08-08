import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import type { ClientConnection, SessionNotification } from '@agentclientprotocol/sdk'
import type {
  AcpSessionInfo,
  AcpSessionResult,
  AgentCommand,
  AgentMode,
  AgentState,
  ChatMessage,
  LoadedSession,
  PromptRequest
} from '../../shared/acp'
import { automationsFilePath } from './automation-store'
import { todosFilePath } from './todo-store'

export class AcpBridge extends EventEmitter {
  private agentProcess?: ChildProcessWithoutNullStreams
  private connection?: ClientConnection
  private state: AgentState = { status: 'disconnected' }
  private sessionCwd?: string
  private activeSessionId?: string
  private connectPromise?: Promise<AgentState>
  /** 临时收集 session/load 回放通知的监听器。 */
  private sessionUpdateListener?: (notification: SessionNotification) => void

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

  async connect(cwd: string): Promise<AgentState> {
    // 同一目录已就绪则直接复用；切换工作目录时重启 ACP 适配器
    if ((this.state.status === 'ready' || this.state.status === 'working') && this.sessionCwd === cwd) {
      return this.state
    }
    if (this.state.status === 'ready' || this.state.status === 'working') {
      this.dispose()
    }
    // 防止并发触发多次连接（例如 React StrictMode 双调用）
    if (!this.connectPromise) {
      this.connectPromise = this.establishConnection(cwd).finally(() => {
        this.connectPromise = undefined
      })
    }
    return this.connectPromise
  }

  private async establishConnection(cwd: string): Promise<AgentState> {
    this.setState({ status: 'connecting', detail: '正在启动 Claude ACP 适配器…' })

    try {
      const adapterPath = require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
      const agentProcess = spawn(process.execPath, [adapterPath], {
        cwd,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['pipe', 'pipe', 'pipe']
      })
      this.agentProcess = agentProcess
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
        .onRequest(acp.methods.client.session.requestPermission, () => ({ outcome: { outcome: 'cancelled' } }))
        .onNotification(acp.methods.client.session.update, (context) => this.handleSessionUpdate(context.params))

      this.connection = client.connect(stream)
      await this.connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: {}
      })
      this.sessionCwd = cwd
      this.setState({ status: 'ready', detail: 'Claude 已连接' })
      this.emit('message', this.systemMessage('已连接 Claude ACP。当前会话默认会拒绝需要额外确认的工具权限。'))
    } catch (error) {
      this.dispose()
      this.setState({ status: 'error', detail: error instanceof Error ? error.message : '无法连接 Claude ACP。' })
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

  /** 通过 ACP session/load 加载历史会话，收集回放的消息并设为当前会话。 */
  async loadSession(sessionId: string, cwd: string): Promise<LoadedSession> {
    if (!this.connection) throw new Error('请先连接 Claude ACP。')

    const collected: ChatMessage[] = []
    let collectedCommands: acp.AvailableCommand[] | undefined
    const byId = new Map<string, ChatMessage>()
    const pushText = (
      id: string | undefined,
      role: 'user' | 'assistant',
      kind: 'text' | 'thinking',
      text: string
    ): void => {
      const key = id ?? (role === 'assistant' ? 'assistant' : crypto.randomUUID())
      const existing = byId.get(key)
      if (existing) {
        existing.content += text
      } else {
        const message: ChatMessage = { id: key, role, kind, content: text, createdAt: new Date().toISOString() }
        byId.set(key, message)
        collected.push(message)
      }
    }

    let resolveDone: (() => void) | undefined
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })

    this.sessionUpdateListener = (notification) => {
      if (notification.sessionId !== sessionId) return
      const update = notification.update
      // 回放是渐进式送达的；adapter 在回放结束后发送 available_commands_update，作为完成信号
      if (update.sessionUpdate === 'available_commands_update') {
        collectedCommands = update.availableCommands
        resolveDone?.()
        return
      }
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
        pushText(update.messageId ?? undefined, 'assistant', 'text', update.content.text)
      } else if (update.sessionUpdate === 'agent_thought_chunk' && update.content.type === 'text') {
        // 思考过程：与正文区分 id，避免被按 messageId 合并
        pushText(
          update.messageId ? `${update.messageId}:thinking` : undefined,
          'assistant',
          'thinking',
          update.content.text
        )
      } else if (update.sessionUpdate === 'user_message_chunk' && update.content.type === 'text') {
        pushText(update.messageId ?? undefined, 'user', 'text', update.content.text)
      } else if (update.sessionUpdate === 'tool_call') {
        collected.push({
          id: crypto.randomUUID(),
          role: 'system',
          kind: 'tool',
          title: update.title,
          content: '',
          createdAt: new Date().toISOString()
        })
      }
    }

    let response: acp.LoadSessionResponse
    try {
      response = await this.connection.agent.request(acp.methods.agent.session.load, { sessionId, cwd, mcpServers: this.automationMcpServers() })
      // 等待回放完成信号（兜底 30s），再给最后的 chunk 一点落定时间
      await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 30000))])
      await new Promise((resolve) => setTimeout(resolve, 300))
    } finally {
      this.sessionUpdateListener = undefined
    }

    this.activeSessionId = sessionId
    const modes = this.toAgentModes(response.modes)
    this.setState({
      ...this.state,
      sessionId,
      modes,
      currentModeId: response.modes?.currentModeId,
      commands: this.toAgentCommands(collectedCommands)
    })
    return { sessionId, messages: collected, modes, currentModeId: response.modes?.currentModeId }
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
    if (!this.connection) throw new Error('请先连接 Claude ACP。')
    const response = await this.connection.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: this.automationMcpServers() })
    this.activeSessionId = response.sessionId
    this.sessionCwd = cwd
    const modes = this.toAgentModes(response.modes)
    this.setState({ ...this.state, sessionId: response.sessionId, modes, currentModeId: response.modes?.currentModeId })
    return { sessionId: response.sessionId, modes, currentModeId: response.modes?.currentModeId }
  }

  async prompt(request: PromptRequest): Promise<void> {
    if (!this.activeSessionId || this.state.status !== 'ready') {
      throw new Error('请先连接 Claude ACP。')
    }

    this.setState({ ...this.state, status: 'working', detail: 'Claude 正在处理…' })
    this.emit('message', {
      id: crypto.randomUUID(),
      role: 'user',
      content: request.text,
      createdAt: new Date().toISOString()
    } satisfies ChatMessage)

    try {
      await this.connection!.agent.request(acp.methods.agent.session.prompt, {
        sessionId: this.activeSessionId,
        prompt: [{ type: 'text', text: request.text }]
      })
      this.setState({ ...this.state, status: 'ready', detail: 'Claude 已就绪' })
    } catch (error) {
      this.emit('message', this.systemMessage(error instanceof Error ? error.message : 'Claude 未能完成请求。'))
      this.setState({ ...this.state, status: 'ready', detail: 'Claude 已就绪' })
    }
  }

  async stop(): Promise<void> {
    if (this.connection && this.activeSessionId) {
      await this.connection.agent.notify(acp.methods.agent.session.cancel, { sessionId: this.activeSessionId })
      this.setState({ ...this.state, status: 'ready', detail: '已停止生成' })
    }
  }

  async setMode(modeId: string): Promise<void> {
    if (!this.connection || !this.activeSessionId) {
      throw new Error('请先连接 Claude ACP。')
    }
    await this.connection.agent.request(acp.methods.agent.session.setMode, {
      sessionId: this.activeSessionId,
      modeId
    })
    this.setState({ ...this.state, currentModeId: modeId })
  }

  dispose(): void {
    this.activeSessionId = undefined
    this.sessionCwd = undefined
    this.sessionUpdateListener = undefined
    this.connection?.close()
    this.agentProcess?.kill()
    this.connection = undefined
    this.agentProcess = undefined
    if (this.state.status !== 'error') this.setState({ status: 'disconnected' })
  }

  /** 把 ACP 的 session/update 通知路由到临时监听器或当前会话。 */
  private handleSessionUpdate(notification: SessionNotification): void {
    if (this.sessionUpdateListener) {
      this.sessionUpdateListener(notification)
      return
    }
    if (!this.activeSessionId || notification.sessionId !== this.activeSessionId) return
    const update = notification.update
    if (update.sessionUpdate === 'available_commands_update') {
      this.setState({ ...this.state, commands: this.toAgentCommands(update.availableCommands) })
      return
    }
    if (update.sessionUpdate === 'current_mode_update') {
      this.setState({ ...this.state, currentModeId: update.currentModeId })
      return
    }
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      this.emit('message', {
        id: update.messageId ?? 'assistant-stream',
        role: 'assistant',
        kind: 'text',
        content: update.content.text,
        createdAt: new Date().toISOString()
      } satisfies ChatMessage)
    } else if (update.sessionUpdate === 'agent_thought_chunk' && update.content.type === 'text') {
      this.emit('message', {
        id: `${update.messageId ?? 'assistant-stream'}:thinking`,
        role: 'assistant',
        kind: 'thinking',
        content: update.content.text,
        createdAt: new Date().toISOString()
      } satisfies ChatMessage)
    } else if (update.sessionUpdate === 'tool_call') {
      this.emit('message', {
        id: crypto.randomUUID(),
        role: 'system',
        kind: 'tool',
        title: update.title,
        content: '',
        createdAt: new Date().toISOString()
      } satisfies ChatMessage)
    }
  }

  private setState(state: AgentState): void {
    this.state = state
    this.emit('state', state)
  }

  private systemMessage(content: string): ChatMessage {
    return { id: crypto.randomUUID(), role: 'system', content, createdAt: new Date().toISOString() }
  }

  private toAgentModes(modes: acp.SessionModeState | null | undefined): AgentMode[] | undefined {
    return modes?.availableModes.map((mode) => ({ id: mode.id, name: mode.name, description: mode.description ?? undefined }))
  }
}
