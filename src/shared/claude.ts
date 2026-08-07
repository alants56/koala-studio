/** Claude Code 本地资源的跨进程数据模型。 */
export interface ClaudeSkill {
  id: string
  name: string
  description: string
  path: string
  updatedAt: string
}

export interface ClaudePlugin {
  id: string
  name: string
  marketplace: string
  version: string
  scope: 'user' | 'project' | 'local'
  projectPath?: string
  installedAt: string
  updatedAt: string
  installPath: string
  enabled: boolean
}

export type ClaudeMcpScope = 'user' | 'project'

export interface ClaudeMcp {
  id: string
  name: string
  scope: ClaudeMcpScope
  projectPath?: string
  config: Record<string, unknown>
}

export interface ClaudeResources {
  skills: ClaudeSkill[]
  plugins: ClaudePlugin[]
  mcps: ClaudeMcp[]
}

export interface ClaudeDailyActivity {
  date: string
  messageCount: number
  sessionCount: number
  toolCallCount: number
}

export interface ClaudeModelUsage {
  name: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
}

/** Claude Code 维护在 ~/.claude/stats-cache.json 中的本地统计摘要。 */
export interface ClaudeUsage {
  refreshedAt: string
  lastComputedDate: string
  firstSessionDate: string
  totalSessions: number
  totalMessages: number
  totalToolCalls: number
  activeDays: number
  longestSessionDuration: number
  longestSessionMessages: number
  dailyActivity: ClaudeDailyActivity[]
  models: ClaudeModelUsage[]
}

export interface SaveClaudeSkillInput {
  id?: string
  name: string
  content: string
}

export interface SaveClaudeMcpInput {
  originalName?: string
  name: string
  scope: ClaudeMcpScope
  projectPath?: string
  config: Record<string, unknown>
}

export type ClaudePluginAction = 'enable' | 'disable' | 'update' | 'uninstall'

export interface ClaudeApi {
  list: () => Promise<ClaudeResources>
  usage: () => Promise<ClaudeUsage>
  readSkill: (id: string) => Promise<string>
  saveSkill: (input: SaveClaudeSkillInput) => Promise<void>
  removeSkill: (id: string) => Promise<void>
  saveMcp: (input: SaveClaudeMcpInput) => Promise<void>
  removeMcp: (name: string, scope: ClaudeMcpScope, projectPath?: string) => Promise<void>
  pluginAction: (action: ClaudePluginAction, id: string) => Promise<void>
  reveal: (path: string) => Promise<void>
}
