import type { AgentAdapterId } from './acp'

/** 本地 Agent 资源（claude 与 pi 共用同一套数据模型）。 */
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
  list: (agent: AgentAdapterId) => Promise<ClaudeResources>
  readSkill: (agent: AgentAdapterId, id: string) => Promise<string>
  saveSkill: (agent: AgentAdapterId, input: SaveClaudeSkillInput) => Promise<void>
  removeSkill: (agent: AgentAdapterId, id: string) => Promise<void>
  saveMcp: (agent: AgentAdapterId, input: SaveClaudeMcpInput) => Promise<void>
  removeMcp: (agent: AgentAdapterId, name: string, scope: ClaudeMcpScope, projectPath?: string) => Promise<void>
  pluginAction: (agent: AgentAdapterId, action: ClaudePluginAction, id: string) => Promise<void>
  reveal: (agent: AgentAdapterId, path: string) => Promise<void>
}
