import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import type {
  ClaudeMcp,
  ClaudePlugin,
  ClaudePluginAction,
  ClaudeResources,
  ClaudeSkill,
  ClaudeUsage,
  SaveClaudeMcpInput,
  SaveClaudeSkillInput
} from '../../shared/claude'

const execFileAsync = promisify(execFile)
const claudeHome = join(homedir(), '.claude')
const skillsPath = join(claudeHome, 'skills')
const pluginsPath = join(claudeHome, 'plugins')
const settingsPath = join(claudeHome, 'settings.json')
const claudeConfigPath = join(homedir(), '.claude.json')
const projectsPath = join(claudeHome, 'projects')

type JsonObject = Record<string, unknown>

interface InstalledPluginRecord {
  scope?: 'user' | 'project' | 'local'
  projectPath?: string
  installPath?: string
  version?: string
  installedAt?: string
  lastUpdated?: string
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJson(path: string): Promise<JsonObject> {
  try {
    const raw = await fs.readFile(path, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return isObject(parsed) ? parsed : {}
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error(`无法读取 ${basename(path)}：${error instanceof Error ? error.message : '配置格式无效'}`)
  }
}

async function writeJsonAtomic(path: string, value: JsonObject): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await fs.rename(temporaryPath, path)
}

function safeId(id: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new Error('名称只能包含字母、数字、连字符和下划线。')
  return id
}

function safeClaudePath(path: string): string {
  const absolute = resolve(path)
  if (relative(claudeHome, absolute).startsWith('..')) throw new Error('只能打开 Claude 本地目录中的资源。')
  return absolute
}

function pluginName(id: string): { name: string; marketplace: string } {
  const at = id.lastIndexOf('@')
  return at > 0 ? { name: id.slice(0, at), marketplace: id.slice(at + 1) } : { name: id, marketplace: '本地' }
}

function descriptionFromSkill(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?^description:\s*['\"]?(.+?)['\"]?\s*$[\s\S]*?^---/m)
  return match?.[1]?.trim() ?? '未填写描述'
}

async function listSkills(): Promise<ClaudeSkill[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(skillsPath, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const skills = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const filePath = join(skillsPath, entry.name, 'SKILL.md')
    try {
      const [content, stats] = await Promise.all([fs.readFile(filePath, 'utf8'), fs.stat(filePath)])
      const name = content.match(/^name:\s*(.+)\s*$/m)?.[1]?.trim() || entry.name
      return { id: entry.name, name, description: descriptionFromSkill(content), path: filePath, updatedAt: stats.mtime.toISOString() } satisfies ClaudeSkill
    } catch {
      return undefined
    }
  }))
  return skills.filter((skill): skill is ClaudeSkill => skill !== undefined).sort((a, b) => a.name.localeCompare(b.name))
}

async function listPlugins(): Promise<ClaudePlugin[]> {
  const [installed, settings] = await Promise.all([readJson(join(pluginsPath, 'installed_plugins.json')), readJson(settingsPath)])
  const installedPlugins = isObject(installed.plugins) ? installed.plugins : {}
  const enabledPlugins = isObject(settings.enabledPlugins) ? settings.enabledPlugins : {}
  const plugins: ClaudePlugin[] = []

  for (const [id, records] of Object.entries(installedPlugins)) {
    if (!Array.isArray(records)) continue
    const parsedName = pluginName(id)
    for (const record of records) {
      if (!isObject(record)) continue
      const item = record as InstalledPluginRecord
      plugins.push({
        id,
        name: parsedName.name,
        marketplace: parsedName.marketplace,
        version: item.version ?? '未知版本',
        scope: item.scope ?? 'user',
        projectPath: item.projectPath,
        installedAt: item.installedAt ?? '',
        updatedAt: item.lastUpdated ?? item.installedAt ?? '',
        installPath: item.installPath ?? '',
        enabled: enabledPlugins[id] === true
      })
    }
  }
  return plugins.sort((a, b) => a.name.localeCompare(b.name))
}

function mcpsFromConfig(config: JsonObject): ClaudeMcp[] {
  const result: ClaudeMcp[] = []
  const userServers = isObject(config.mcpServers) ? config.mcpServers : {}
  for (const [name, server] of Object.entries(userServers)) {
    if (isObject(server)) result.push({ id: `user:${name}`, name, scope: 'user', config: server })
  }
  const projects = isObject(config.projects) ? config.projects : {}
  for (const [projectPath, project] of Object.entries(projects)) {
    if (!isObject(project) || !isObject(project.mcpServers)) continue
    for (const [name, server] of Object.entries(project.mcpServers)) {
      if (isObject(server)) result.push({ id: `project:${projectPath}:${name}`, name, scope: 'project', projectPath, config: server })
    }
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

export async function listClaudeResources(): Promise<ClaudeResources> {
  const [skills, plugins, config] = await Promise.all([listSkills(), listPlugins(), readJson(claudeConfigPath)])
  return { skills, plugins, mcps: mcpsFromConfig(config) }
}

interface TranscriptMessage {
  type?: unknown
  uuid?: unknown
  sessionId?: unknown
  timestamp?: unknown
  message?: {
    id?: unknown
    role?: unknown
    model?: unknown
    content?: unknown
    usage?: {
      input_tokens?: unknown
      output_tokens?: unknown
      cache_read_input_tokens?: unknown
      cache_creation_input_tokens?: unknown
    }
  }
}

interface UsageMessage {
  id: string
  sessionId: string
  date: string
  timestamp: string
  role: 'user' | 'assistant'
  model?: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  toolCalls: number
}

async function findTranscriptFiles(directory: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const children = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return findTranscriptFiles(path)
    return entry.isFile() && entry.name.endsWith('.jsonl') ? [path] : []
  }))
  return children.flat()
}

function countToolCalls(content: unknown): number {
  if (!Array.isArray(content)) return 0
  return content.filter((item) => isObject(item) && item.type === 'tool_use').length
}

function localDateKey(timestamp: string): string | undefined {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return undefined
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function messageFromTranscript(value: unknown): UsageMessage | undefined {
  if (!isObject(value)) return undefined
  const line = value as TranscriptMessage
  if ((line.type !== 'user' && line.type !== 'assistant') || !isObject(line.message)) return undefined
  if (typeof line.sessionId !== 'string' || typeof line.timestamp !== 'string') return undefined
  const date = localDateKey(line.timestamp)
  if (!date) return undefined
  const role = line.type
  const messageId = role === 'assistant' ? line.message.id : line.uuid
  if (typeof messageId !== 'string') return undefined
  const usage = isObject(line.message.usage) ? line.message.usage : {}
  return {
    id: `${line.sessionId}:${role}:${messageId}`,
    sessionId: line.sessionId,
    date,
    timestamp: line.timestamp,
    role,
    model: typeof line.message.model === 'string' ? line.message.model : undefined,
    inputTokens: asNumber(usage.input_tokens),
    outputTokens: asNumber(usage.output_tokens),
    cacheReadTokens: asNumber(usage.cache_read_input_tokens),
    cacheWriteTokens: asNumber(usage.cache_creation_input_tokens),
    toolCalls: countToolCalls(line.message.content)
  }
}

/**
 * 直接汇总 Claude Code 的会话日志，而不是依赖更新不及时的 stats-cache.json。
 * 同一个 assistant 消息在流式输出中会记录多次，Map 会保留最后一条完整记录。
 */
export async function getClaudeUsage(): Promise<ClaudeUsage> {
  const files = await findTranscriptFiles(projectsPath)
  const logs = await Promise.all(files.map(async (path) => {
    try {
      return await fs.readFile(path, 'utf8')
    } catch {
      return ''
    }
  }))
  const messages = new Map<string, UsageMessage>()

  for (const log of logs) {
    for (const line of log.split('\n')) {
      if (!line.trim()) continue
      try {
        const message = messageFromTranscript(JSON.parse(line) as unknown)
        if (message) messages.set(message.id, message)
      } catch {
        // Claude Code may still be appending a final partial JSON line; it is safe to skip.
      }
    }
  }

  const daily = new Map<string, { messageCount: number; sessions: Set<string>; toolCallCount: number }>()
  const models = new Map<string, { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>()
  const sessions = new Map<string, { first: string; last: string; messageCount: number }>()

  for (const message of messages.values()) {
    const day = daily.get(message.date) ?? { messageCount: 0, sessions: new Set<string>(), toolCallCount: 0 }
    day.messageCount += 1
    day.sessions.add(message.sessionId)
    day.toolCallCount += message.toolCalls
    daily.set(message.date, day)

    const session = sessions.get(message.sessionId) ?? { first: message.timestamp, last: message.timestamp, messageCount: 0 }
    session.first = session.first < message.timestamp ? session.first : message.timestamp
    session.last = session.last > message.timestamp ? session.last : message.timestamp
    session.messageCount += 1
    sessions.set(message.sessionId, session)

    if (message.role === 'assistant' && message.model) {
      const model = models.get(message.model) ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }
      model.inputTokens += message.inputTokens
      model.outputTokens += message.outputTokens
      model.cacheReadTokens += message.cacheReadTokens
      model.cacheWriteTokens += message.cacheWriteTokens
      models.set(message.model, model)
    }
  }

  const sortedDates = [...daily.keys()].sort()
  const longest = [...sessions.values()].reduce((current, session) => {
    const duration = Math.max(new Date(session.last).getTime() - new Date(session.first).getTime(), 0)
    return duration > current.duration ? { duration, messageCount: session.messageCount } : current
  }, { duration: 0, messageCount: 0 })

  return {
    refreshedAt: new Date().toISOString(),
    lastComputedDate: sortedDates.at(-1) ?? '',
    firstSessionDate: sortedDates[0] ?? '',
    totalSessions: sessions.size,
    totalMessages: messages.size,
    totalToolCalls: [...daily.values()].reduce((total, day) => total + day.toolCallCount, 0),
    activeDays: daily.size,
    longestSessionDuration: longest.duration,
    longestSessionMessages: longest.messageCount,
    dailyActivity: sortedDates.map((date) => {
      const day = daily.get(date)!
      return { date, messageCount: day.messageCount, sessionCount: day.sessions.size, toolCallCount: day.toolCallCount }
    }),
    models: [...models.entries()].map(([name, value]) => ({
      name,
      ...value,
      totalTokens: value.inputTokens + value.outputTokens + value.cacheReadTokens + value.cacheWriteTokens
    })).sort((a, b) => b.totalTokens - a.totalTokens)
  }
}

export async function readClaudeSkill(id: string): Promise<string> {
  return fs.readFile(join(skillsPath, safeId(id), 'SKILL.md'), 'utf8')
}

export async function saveClaudeSkill(input: SaveClaudeSkillInput): Promise<void> {
  const id = safeId(input.id ?? input.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
  if (!input.content.trim()) throw new Error('Skill 内容不能为空。')
  const targetDirectory = join(skillsPath, id)
  await fs.mkdir(targetDirectory, { recursive: true })
  await fs.writeFile(join(targetDirectory, 'SKILL.md'), input.content.trimEnd() + '\n', 'utf8')
}

export async function removeClaudeSkill(id: string): Promise<void> {
  await fs.rm(join(skillsPath, safeId(id)), { recursive: true, force: true })
}

export async function saveClaudeMcp(input: SaveClaudeMcpInput): Promise<void> {
  const name = safeId(input.name)
  if (!isObject(input.config) || Object.keys(input.config).length === 0) throw new Error('MCP 配置不能为空。')
  if (input.scope === 'project' && !input.projectPath?.trim()) throw new Error('项目级 MCP 需要指定项目目录。')

  const config = await readJson(claudeConfigPath)
  const serverMap = input.scope === 'user'
    ? (isObject(config.mcpServers) ? config.mcpServers : (config.mcpServers = {}))
    : (() => {
        const projects = isObject(config.projects) ? config.projects : (config.projects = {})
        const path = input.projectPath!.trim()
        const project = isObject(projects[path]) ? projects[path] : (projects[path] = {})
        return isObject(project.mcpServers) ? project.mcpServers : (project.mcpServers = {})
      })()
  if (input.originalName && input.originalName !== name) delete serverMap[input.originalName]
  serverMap[name] = input.config
  await writeJsonAtomic(claudeConfigPath, config)
}

export async function removeClaudeMcp(name: string, scope: 'user' | 'project', projectPath?: string): Promise<void> {
  const config = await readJson(claudeConfigPath)
  if (scope === 'user' && isObject(config.mcpServers)) delete config.mcpServers[safeId(name)]
  if (scope === 'project' && projectPath && isObject(config.projects) && isObject(config.projects[projectPath])) {
    const project = config.projects[projectPath]
    if (isObject(project.mcpServers)) delete project.mcpServers[safeId(name)]
  }
  await writeJsonAtomic(claudeConfigPath, config)
}

export async function runClaudePluginAction(action: ClaudePluginAction, id: string): Promise<void> {
  if (!['enable', 'disable', 'update', 'uninstall'].includes(action)) throw new Error('不支持的插件操作。')
  if (!/^[\w.-]+@[\w.-]+$/.test(id)) throw new Error('插件标识无效。')
  try {
    await execFileAsync('claude', ['plugin', action, id], { timeout: 60_000, maxBuffer: 1_000_000 })
  } catch (error) {
    const detail = error as { stderr?: string; message?: string }
    throw new Error(detail.stderr?.trim() || detail.message || 'Claude CLI 未能完成插件操作。')
  }
}

export async function revealClaudePath(path: string): Promise<void> {
  const error = await shell.openPath(safeClaudePath(path))
  if (error) throw new Error(error)
}
