export type AgentStatus = 'disconnected' | 'connecting' | 'ready' | 'working' | 'error'

export interface AgentMode {
  id: string
  name: string
  description?: string
}

/** ACP 会话提供的模型选择项。 */
export interface AgentModelOption {
  value: string
  name: string
  description?: string
}

/** 当前会话的模型选择器，由 ACP adapter 提供真实可用的模型列表。 */
export interface AgentModel {
  configId: string
  name: string
  currentValue: string
  options: AgentModelOption[]
}

/** Claude Code 的可用 slash 命令（来自 ACP 的 available_commands_update）。 */
export interface AgentCommand {
  name: string
  description: string
  /** 命令所需的参数提示，例如 model 的 "[模型名]"；无参数时省略。 */
  hint?: string
}

export interface AgentState {
  status: AgentStatus
  sessionId?: string
  detail?: string
  modes?: AgentMode[]
  currentModeId?: string
  model?: AgentModel
  /** 当前会话可用的 slash 命令，随会话变化。 */
  commands?: AgentCommand[]
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
  modes?: AgentMode[]
  currentModeId?: string
}

/** session/load 回放的历史消息。 */
export interface LoadedSession {
  sessionId: string
  messages: ChatMessage[]
  modes?: AgentMode[]
  currentModeId?: string
}

export interface AcpApi {
  getState: () => Promise<AgentState>
  connect: (cwd: string) => Promise<AgentState>
  prompt: (request: PromptRequest) => Promise<void>
  stop: () => Promise<void>
  setMode: (modeId: string) => Promise<void>
  setModel: (modelId: string) => Promise<void>
  /** 通过 ACP session/list 查询 Claude Code 在该目录下的会话记录。 */
  listSessions: (cwd: string) => Promise<AcpSessionInfo[]>
  /** 通过 ACP session/load 加载历史会话，并返回回放的消息。 */
  loadSession: (sessionId: string, cwd: string) => Promise<LoadedSession>
  /** 通过 ACP session/new 新建一个会话。 */
  createSession: (cwd: string) => Promise<AcpSessionResult>
  onState: (listener: (state: AgentState) => void) => () => void
  onMessage: (listener: (message: ChatMessage) => void) => () => void
}
