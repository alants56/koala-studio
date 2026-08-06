export type AgentStatus = 'disconnected' | 'connecting' | 'ready' | 'working' | 'error'

export interface AgentState {
  status: AgentStatus
  sessionId?: string
  detail?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
  /** 消息类型：普通文本 / 思考过程 / 工具调用。 */
  kind?: 'text' | 'thinking' | 'tool'
  /** 工具调用时显示的工具名。 */
  title?: string
}

export interface PromptRequest {
  text: string
  cwd: string
}

/** ACP 会话摘要（来自 Claude Code 的 session/list）。 */
export interface AcpSessionInfo {
  sessionId: string
  title: string
  updatedAt: string
  cwd: string
}

export interface AcpSessionResult {
  sessionId: string
}

/** session/load 回放的历史消息。 */
export interface LoadedSession {
  sessionId: string
  messages: ChatMessage[]
}

export interface AcpApi {
  getState: () => Promise<AgentState>
  connect: (cwd: string) => Promise<AgentState>
  prompt: (request: PromptRequest) => Promise<void>
  stop: () => Promise<void>
  /** 通过 ACP session/list 查询 Claude Code 在该目录下的会话记录。 */
  listSessions: (cwd: string) => Promise<AcpSessionInfo[]>
  /** 通过 ACP session/load 加载历史会话，并返回回放的消息。 */
  loadSession: (sessionId: string, cwd: string) => Promise<LoadedSession>
  /** 通过 ACP session/new 新建一个会话。 */
  createSession: (cwd: string) => Promise<AcpSessionResult>
  onState: (listener: (state: AgentState) => void) => () => void
  onMessage: (listener: (message: ChatMessage) => void) => () => void
}
