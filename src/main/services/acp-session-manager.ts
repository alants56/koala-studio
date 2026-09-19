import { EventEmitter } from 'node:events'
import type { AcpBridge } from './acp-bridge'
import type { AgentAdapterId, AgentState, ChatMessage, LoadedSession, PromptRequest, SessionTarget } from '../../shared/acp'
import { mergeChatMessage } from '../../shared/chat-messages'

export const MAX_SESSION_RUNTIMES = 3

type SessionBridge = Pick<AcpBridge, 'on' | 'removeAllListeners' | 'connect' | 'getState' | 'loadSession' | 'createSession' | 'prompt' | 'stop' | 'removeQueuedPrompt' | 'steerQueuedPrompt' | 'setMode' | 'setModel' | 'setEffort' | 'respondPermission' | 'dispose'>

interface Runtime {
  bridge: SessionBridge
  agent: AgentAdapterId
  cwd: string
  sessionId?: string
  messages: ChatMessage[]
  state: AgentState
  revision: number
  lastUsed: number
  opening: boolean
  operations: number
}

interface Options {
  createBridge: (agent: AgentAdapterId) => SessionBridge
  getPreferredAgentId: () => Promise<string | undefined>
  setPreferredAgentId: (agent: AgentAdapterId) => Promise<void>
}

/** Each live session owns its process, stream, permission resolver and FIFO queue. */
export class AcpSessionManager extends EventEmitter {
  private runtimes = new Set<Runtime>()
  private currentAgent: AgentAdapterId = 'claude'
  private agentReady?: Promise<void>
  private active?: Runtime
  private opening = Promise.resolve()
  private disposed = false
  private revision = 0

  constructor(private readonly options: Options) { super() }

  async getCurrentAgent(): Promise<AgentAdapterId> {
    this.agentReady ??= this.options.getPreferredAgentId().then((agent) => {
      if (agent === 'claude' || agent === 'pi') this.currentAgent = agent
    })
    await this.agentReady
    return this.currentAgent
  }

  getState(target?: SessionTarget): AgentState {
    if (target) return this.runtime(target).state
    return this.active?.agent === this.currentAgent
      ? this.active.state
      : { status: 'disconnected', currentAgent: this.currentAgent }
  }

  getSessionStates(): AgentState[] {
    return [...this.runtimes].filter((entry) => entry.sessionId && !entry.opening).map((entry) => entry.state)
  }

  async setAgent(agent: AgentAdapterId): Promise<void> {
    if (agent !== 'claude' && agent !== 'pi') throw new Error('不支持所选 Agent。')
    await this.getCurrentAgent()
    await this.options.setPreferredAgentId(agent)
    this.currentAgent = agent
    this.active = undefined
    // Agent selection changes are global; background session events are not.
    this.emit('state', this.getState())
  }

  async connect(cwd: string): Promise<AgentState> {
    const currentAgent = await this.getCurrentAgent()
    // Actual connection belongs to load/new, never to a directory-wide singleton.
    return { status: 'ready', cwd, currentAgent }
  }

  loadSession(sessionId: string, cwd: string, agent?: AgentAdapterId): Promise<LoadedSession> {
    return this.openSession(cwd, sessionId, agent)
  }

  createSession(cwd: string, agent?: AgentAdapterId): Promise<LoadedSession> {
    return this.openSession(cwd, undefined, agent)
  }

  private async openSession(cwd: string, sessionId?: string, requestedAgent?: AgentAdapterId): Promise<LoadedSession> {
    const agent = requestedAgent ?? await this.getCurrentAgent()
    if (agent !== 'claude' && agent !== 'pi') throw new Error('不支持所选 Agent。')
    // Reserve capacity before any await and serialize load/new to prevent duplicate runtimes.
    const operation = this.opening.then(async () => {
      if (this.disposed) throw new Error('ACP 会话管理器已关闭。')
      const existing = [...this.runtimes].find((entry) => entry.agent === agent && entry.cwd === cwd && entry.sessionId === sessionId && sessionId)
      if (existing && existing.state.status !== 'error' && existing.state.status !== 'disconnected') {
        existing.lastUsed = Date.now()
        this.active = existing
        return this.snapshot(existing)
      }
      if (existing) this.remove(existing)
      if (this.runtimes.size >= MAX_SESSION_RUNTIMES) {
        const idle = [...this.runtimes]
          .filter((entry) => !entry.opening && !entry.operations && entry.state.status !== 'working' && !entry.state.pendingPermission && !entry.state.queueDepth)
          .sort((a, b) => a.lastUsed - b.lastUsed)[0]
        if (!idle) throw new Error('最多同时运行 3 个会话。请等待其中一个任务完成或停止后，再打开新会话；现有任务仍在后台执行。')
        this.remove(idle)
      }
      const bridge = this.options.createBridge(agent)
      const entry: Runtime = { bridge, agent, cwd, sessionId, messages: [], state: { status: 'connecting' }, revision: 0, lastUsed: Date.now(), opening: true, operations: 0 }
      this.runtimes.add(entry)
      bridge.on('state', (state: AgentState) => {
        if (!this.runtimes.has(entry)) return
        entry.sessionId ??= state.sessionId
        entry.state = { ...state, sessionId: entry.sessionId, cwd, currentAgent: agent, revision: (entry.revision = ++this.revision) }
        if (entry.sessionId) this.emit('state', entry.state)
      })
      bridge.on('message', (message: ChatMessage) => {
        if (!this.runtimes.has(entry)) return
        entry.messages = mergeChatMessage(entry.messages, message)
        const revision = (entry.revision = ++this.revision)
        if (entry.sessionId) this.emit('message', { sessionId: entry.sessionId, cwd, currentAgent: agent, revision, message })
      })
      try {
        const connected = await bridge.connect(cwd)
        if (connected.status !== 'ready') throw new Error(connected.detail ?? '无法连接 ACP。')
        const result = sessionId ? await bridge.loadSession(sessionId, cwd) : await bridge.createSession(cwd)
        if (!this.runtimes.has(entry)) throw new Error('ACP 会话已关闭。')
        entry.sessionId = result.sessionId
        entry.state = { ...bridge.getState(), sessionId: result.sessionId, cwd, currentAgent: agent, revision: entry.revision }
        this.active = entry
        return this.snapshot(entry)
      } catch (error) {
        this.remove(entry)
        throw error
      } finally {
        entry.opening = false
      }
    })
    this.opening = operation.then(() => undefined, () => undefined)
    return operation
  }

  private snapshot(entry: Runtime): LoadedSession {
    return { sessionId: entry.sessionId!, messages: entry.messages, state: entry.state, revision: entry.revision, modes: entry.state.modes, currentModeId: entry.state.currentModeId }
  }

  private runtime(target: SessionTarget): Runtime {
    if (!target?.sessionId || !target.cwd || !target.currentAgent) throw new Error('请求缺少会话标识，请重新打开会话。')
    const entry = [...this.runtimes].find((item) => item.sessionId === target.sessionId && item.cwd === target.cwd && item.agent === target.currentAgent)
    if (!entry || entry.opening) throw new Error('该会话未连接，请重新打开会话。')
    entry.lastUsed = Date.now()
    return entry
  }

  /** 删除历史会话前先卸掉对应的运行实例，避免在途请求把已删除的会话重新写回磁盘。 */
  releaseSession(sessionId: string, cwd: string, agent: AgentAdapterId): void {
    const entry = [...this.runtimes].find((item) => item.sessionId === sessionId && item.cwd === cwd && item.agent === agent)
    if (entry) this.remove(entry)
  }

  private async run(target: SessionTarget, action: (bridge: SessionBridge) => unknown): Promise<void> {
    const entry = this.runtime(target)
    entry.operations++
    try { await action(entry.bridge) } finally { entry.operations-- }
  }

  prompt(request: PromptRequest): Promise<void> {
    if (!request.target || request.target.cwd !== request.cwd) return Promise.reject(new Error('请求缺少有效的会话标识。'))
    return this.run(request.target, (bridge) => bridge.prompt(request))
  }
  stop(target: SessionTarget): Promise<void> { return this.run(target, (bridge) => bridge.stop()) }
  removeQueuedPrompt(id: string, target: SessionTarget): Promise<void> { return this.run(target, (bridge) => bridge.removeQueuedPrompt(id)) }
  steerQueuedPrompt(id: string, target: SessionTarget): Promise<void> { return this.run(target, (bridge) => bridge.steerQueuedPrompt(id)) }
  setMode(id: string, target: SessionTarget): Promise<void> { return this.run(target, (bridge) => bridge.setMode(id)) }
  setModel(id: string, target: SessionTarget): Promise<void> { return this.run(target, (bridge) => bridge.setModel(id)) }
  setEffort(id: string, target: SessionTarget): Promise<void> { return this.run(target, (bridge) => bridge.setEffort(id)) }
  respondPermission(id: string, target: SessionTarget): Promise<void> { return this.run(target, (bridge) => bridge.respondPermission(id)) }

  private remove(entry: Runtime): void {
    this.runtimes.delete(entry)
    if (this.active === entry) this.active = undefined
    entry.bridge.removeAllListeners()
    entry.bridge.dispose()
  }

  dispose(): void {
    this.disposed = true
    for (const entry of this.runtimes) this.remove(entry)
  }
}
