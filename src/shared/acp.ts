import type { ChatAttachment } from './attachments'

export type AgentAdapterId = 'claude' | 'pi'

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

/** ACP 会话提供的推理强度选择项。 */
export interface AgentEffortOption {
  value: string
  name: string
}

/** 当前会话的推理强度选择器，仅在模型支持时出现。 */
export interface AgentEffort {
  configId: string
  name: string
  currentValue: string
  options: AgentEffortOption[]
}

/** Claude Code 的可用 slash 命令（来自 ACP 的 available_commands_update）。 */
export interface AgentCommand {
  name: string
  description: string
  /** 命令所需的参数提示，例如 model 的 "[模型名]"；无参数时省略。 */
  hint?: string
}

export interface AgentPermissionOption {
  optionId: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

export interface AgentPermissionRequest {
  toolTitle?: string
  options: AgentPermissionOption[]
}

export interface AgentUsage {
  used: number
  size: number
}

export interface AgentQueuedPrompt {
  id: string
  text: string
  attachmentNames: string[]
}

export interface AgentState {
  status: AgentStatus
  sessionId?: string
  detail?: string
  /** 当前 turn 的开始时间戳，用于跨页面恢复执行时长。 */
  workStartedAt?: number
  /** 最近一次完成 turn 的执行秒数（任务结束后仍可展示摘要）。 */
  lastTurnSeconds?: number
  modes?: AgentMode[]
  currentModeId?: string
  model?: AgentModel
  /** 当前会话的推理强度选择器，仅模型支持时存在。 */
  effort?: AgentEffort
  /** 当前会话可用的 slash 命令，随会话变化。 */
  commands?: AgentCommand[]
  usage?: AgentUsage
  /** 当前待确认的权限请求（输入框上方展示）。 */
  pendingPermission?: AgentPermissionRequest
  /** 当前使用的 ACP 适配器。 */
  currentAgent?: AgentAdapterId
  /** 当前 ACP 适配器是否支持 turn 引导（ACP 的 _session/steering 扩展）。 */
  steeringSupported?: boolean
  /** 当前排队待处理的消息数量（Agent 忙碌时新消息会进入本地 FIFO 队列）。 */
  queueDepth?: number
  /** 当前排队消息，供输入框上方展示、删除或调整方向。 */
  queuedPrompts?: AgentQueuedPrompt[]
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
  /** 工具调用状态（kind 'tool' 专用）。 */
  toolStatus?: 'pending' | 'in_progress' | 'completed' | 'failed'
  /** ACP 工具类别（read/edit/execute/fetch…），供 UI 选择展示方式。 */
  toolKind?: string
  /** 工具命令退出码（来自 ACP terminal_exit）。 */
  exitCode?: number
  /** 工具已执行秒数（来自 Claude 适配器心跳）。 */
  elapsedSeconds?: number
  /** 工具输出超长被截断。 */
  outputTruncated?: boolean
  /** 与消息一同发送或生成的本地附件。 */
  attachments?: ChatAttachment[]
}

export interface PromptRequest {
  text: string
  cwd: string
  attachments?: ChatAttachment[]
}

/** ACP 会话摘要（来自 Claude Code 的 session/list）。 */
export interface AcpSessionInfo {
  sessionId: string
  title: string
  updatedAt: string
  cwd: string
  /** 该历史会话中持久化等待处理的消息数量。 */
  queueDepth?: number
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
  removeQueuedPrompt: (id: string) => Promise<void>
  steerQueuedPrompt: (id: string) => Promise<void>
  stop: () => Promise<void>
  setMode: (modeId: string) => Promise<void>
  setModel: (modelId: string) => Promise<void>
  setEffort: (effortId: string) => Promise<void>
  /** 切换 ACP 适配器（claude / pi）。 */
  setAgent: (agentId: AgentAdapterId) => Promise<void>
  /** 通过 ACP session/list 查询 Claude Code 在该目录下的会话记录。 */
  listSessions: (cwd: string) => Promise<AcpSessionInfo[]>
  /** 通过 ACP session/load 加载历史会话，并返回回放的消息。 */
  loadSession: (sessionId: string, cwd: string) => Promise<LoadedSession>
  /** 通过 ACP session/new 新建一个会话。 */
  createSession: (cwd: string) => Promise<AcpSessionResult>
  /** 回复当前待确认的权限请求。*/
  respondPermission: (optionId: string) => Promise<void>
  onState: (listener: (state: AgentState) => void) => () => void
  onMessage: (listener: (message: ChatMessage) => void) => () => void
}
