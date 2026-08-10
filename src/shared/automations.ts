export type AutomationState = 'active' | 'paused' | 'attention'
export type AutomationRunStatus = 'success' | 'failed'
export type AutomationRunLogLevel = 'info' | 'success' | 'error'
export type AutomationScheduleType = 'once' | 'daily'
export type AutomationActionType = 'feature_brief' | 'claude_prompt' | 'pi_prompt' | 'create_high_priority_todo'

export interface AutomationSchedule {
  type: AutomationScheduleType
  /** The next scheduled execution time in ISO 8601 UTC format. */
  nextRunAt: string
}

export interface AutomationRun {
  id: string
  status: AutomationRunStatus
  startedAt: string
  duration: string
  summary: string
  detail?: string
  output?: AutomationRunOutput
  logs?: AutomationRunLog[]
}

export interface AutomationRunLog {
  at: string
  level: AutomationRunLogLevel
  message: string
}

export interface AutomationRunOutput {
  title: string
  content: string
  format: 'text' | 'markdown'
}

export interface Automation {
  id: string
  name: string
  description: string
  state: AutomationState
  trigger: string
  triggerDetail: string
  action: string
  actionDetail: string
  scope: string
  runs: AutomationRun[]
  /** Structured execution metadata. Legacy display-only rules do not have it. */
  schedule?: AutomationSchedule
  actionType?: AutomationActionType
  projectPath?: string
  /** Custom instruction executed by an isolated Claude Code session. */
  instruction?: string
}

export interface CreateAutomationInput {
  name: string
  description?: string
  trigger: string
  triggerDetail?: string
  action: string
  actionDetail?: string
  scope: string
  enabled?: boolean
  schedule?: AutomationSchedule
  actionType?: AutomationActionType
  projectPath?: string
  instruction?: string
}

export interface UpdateAutomationInput {
  name?: string
  description?: string
  trigger?: string
  triggerDetail?: string
  action?: string
  actionDetail?: string
  scope?: string
  schedule?: AutomationSchedule | null
  actionType?: AutomationActionType
  projectPath?: string | null
  instruction?: string | null
}

export interface AutomationListInput {
  state?: AutomationState
  query?: string
  limit?: number
  offset?: number
}

export interface AutomationListResult {
  total: number
  count: number
  offset: number
  hasMore: boolean
  nextOffset?: number
  items: Automation[]
}

export interface AutomationsApi {
  list: (input?: AutomationListInput) => Promise<AutomationListResult>
  get: (id: string) => Promise<Automation>
  create: (input: CreateAutomationInput) => Promise<Automation>
  update: (id: string, input: UpdateAutomationInput) => Promise<Automation>
  setEnabled: (id: string, enabled: boolean) => Promise<Automation>
  runTest: (id: string) => Promise<Automation>
  delete: (id: string) => Promise<void>
}
