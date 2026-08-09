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

const DIRECT_IMAGE_MIME_TYPES = new Set(['image/gif', 'image/jpeg', 'image/png', 'image/webp'])
const MAX_EMBEDDED_TEXT_BYTES = 2 * 1024 * 1024

interface AcpBridgeOptions {
  getPreferredModeId?: () => Promise<string | undefined>
  setPreferredModeId?: (modeId: string) => Promise<void>
  getPreferredModelId?: () => Promise<string | undefined>
  setPreferredModelId?: (modelId: string) => Promise<void>
  getPreferredEffortId?: () => Promise<string | undefined>
  setPreferredEffortId?: (effortId: string) => Promise<void>
}

export class AcpBridge extends EventEmitter {
  private agentProcess?: ChildProcessWithoutNullStreams
  private connection?: ClientConnection
  private state: AgentState = { status: 'disconnected' }
  private sessionCwd?: string
  private activeSessionId?: string
  private connectPromise?: Promise<AgentState>
  private permissionResolve?: (optionId: string | null) => void

  constructor(private readonly options: AcpBridgeOptions = {}) {
    super()
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
        .onRequest(acp.methods.client.session.requestPermission, (context) => this.handlePermissionRequest(context.params))
        .onNotification(acp.methods.client.session.update, (context) => this.handleSessionUpdate(context.params))

      this.connection = client.connect(stream)
      await this.connection.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { session: { configOptions: { boolean: {} } } }
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

  /** 通过 ACP session/load 加载历史会话，回放消息通过 onMessage 事件流式推送到 UI。 */
  async loadSession(sessionId: string, cwd: string): Promise<LoadedSession> {
    if (!this.connection) throw new Error('请先连接 Claude ACP。')

    this.activeSessionId = sessionId
    this.sessionCwd = cwd

    const response = await this.connection.agent.request(acp.methods.agent.session.load, {
      sessionId,
      cwd,
      mcpServers: this.automationMcpServers()
    })

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
    if (!this.connection) throw new Error('请先连接 Claude ACP。')
    const response = await this.connection.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: this.automationMcpServers() })
    this.activeSessionId = response.sessionId
    this.sessionCwd = cwd
    const modes = this.toAgentModes(response.modes)
    const model = this.toAgentModel(response.configOptions)
    const effort = this.toAgentEffort(response.configOptions)
    const currentModeId = await this.restorePreferredMode(modes, response.modes?.currentModeId)
    this.setState({ ...this.state, sessionId: response.sessionId, modes, currentModeId, model, effort, usage: undefined })
    await this.restorePreferredModel(this.state.model)
    await this.restorePreferredEffort(this.state.effort)
    return { sessionId: response.sessionId, modes, currentModeId }
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
      attachments: request.attachments,
      createdAt: new Date().toISOString()
    } satisfies ChatMessage)

    try {
      const prompt = await this.toPromptContent(request)
      await this.connection!.agent.request(acp.methods.agent.session.prompt, {
        sessionId: this.activeSessionId,
        prompt
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
    this.activeSessionId = undefined
    this.sessionCwd = undefined
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
    if (update.sessionUpdate === 'user_message_chunk' && update.content.type === 'text') {
      this.emit('message', {
        id: update.messageId ?? crypto.randomUUID(),
        role: 'user',
        kind: 'text',
        content: update.content.text,
        createdAt: new Date().toISOString()
      } satisfies ChatMessage)
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
    } else if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'image') {
      void this.storeImageContent(update.content).then((attachment) => {
        this.emit('message', {
          id: update.messageId ?? 'assistant-stream',
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
