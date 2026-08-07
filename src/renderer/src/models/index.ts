// 渲染进程领域模型：统一从 shared 层复用 IPC 类型，并补充渲染进程专用的视图模型。
export type {
  AcpApi,
  AcpSessionInfo,
  AcpSessionResult,
  AgentMode,
  AgentState,
  AgentStatus,
  ChatMessage,
  LoadedSession,
  PromptRequest
} from '@shared/acp'
export type { CreateProjectInput, Project, ProjectsApi, UpdateProjectInput } from '@shared/projects'

/** 连接状态在 UI 上的展示元信息（antd Badge status + 文案）。 */
export type BadgeStatus = 'success' | 'processing' | 'default' | 'error' | 'warning'

export interface StatusMeta {
  badge: BadgeStatus
  label: string
}
