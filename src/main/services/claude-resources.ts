import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'
import type { AgentAdapterId } from '../../shared/acp'
import type {
  ClaudeMcp,
  ClaudePlugin,
  ClaudePluginAction,
  ClaudeResources,
  ClaudeSkill,
  SaveClaudeMcpInput,
  SaveClaudeSkillInput
} from '../../shared/claude'

const execFileAsync = promisify(execFile)
const claudeHome = join(homedir(), '.claude')
const piHome = join(homedir(), '.pi', 'agent')
const claudeConfigPath = join(homedir(), '.claude.json')

type JsonObject = Record<string, unknown>

interface InstalledPluginRecord {
  scope?: 'user' | 'project' | 'local'
  projectPath?: string
  installPath?: string
  version?: string
  installedAt?: string
  lastUpdated?: string
}

/** 每个 Agent 的本地资源根目录映射。 */
interface AgentHome {
  /** 安全路径检查的根目录。 */
  root: string
  skillsPath: string
  /** 插件目录，pi 无插件机制时为 undefined。 */
  pluginsPath?: string
  settingsPath: string
  /** MCP 配置文件，pi 不支持 MCP 时为 undefined。 */
  mcpConfigPath?: string
}

function agentHomes(agent: AgentAdapterId): AgentHome {
  if (agent === 'pi') {
    return { root: piHome, skillsPath: join(piHome, 'skills'), settingsPath: join(piHome, 'settings.json') }
  }
  return {
    root: claudeHome,
    skillsPath: join(claudeHome, 'skills'),
    pluginsPath: join(claudeHome, 'plugins'),
    settingsPath: join(claudeHome, 'settings.json'),
    mcpConfigPath: claudeConfigPath
  }
}

function assertAgent(agent: AgentAdapterId): void {
  if (agent !== 'claude' && agent !== 'pi') throw new Error('不支持的 Agent 类型。')
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

function safeClaudePath(path: string, root: string): string {
  const absolute = resolve(path)
  if (relative(root, absolute).startsWith('..')) throw new Error('只能打开 Agent 本地目录中的资源。')
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

async function listSkills(agent: AgentAdapterId): Promise<ClaudeSkill[]> {
  const { skillsPath } = agentHomes(agent)
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

async function listPlugins(agent: AgentAdapterId): Promise<ClaudePlugin[]> {
  const { pluginsPath, settingsPath } = agentHomes(agent)
  if (!pluginsPath) return []
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

async function listMcps(agent: AgentAdapterId): Promise<ClaudeMcp[]> {
  const { mcpConfigPath } = agentHomes(agent)
  if (!mcpConfigPath) return []
  const config = await readJson(mcpConfigPath)
  return mcpsFromConfig(config)
}

export async function listClaudeResources(agent: AgentAdapterId): Promise<ClaudeResources> {
  assertAgent(agent)
  const [skills, plugins, mcps] = await Promise.all([listSkills(agent), listPlugins(agent), listMcps(agent)])
  return { skills, plugins, mcps }
}

export async function readClaudeSkill(agent: AgentAdapterId, id: string): Promise<string> {
  assertAgent(agent)
  return fs.readFile(join(agentHomes(agent).skillsPath, safeId(id), 'SKILL.md'), 'utf8')
}

export async function saveClaudeSkill(agent: AgentAdapterId, input: SaveClaudeSkillInput): Promise<void> {
  assertAgent(agent)
  const id = safeId(input.id ?? input.name.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''))
  if (!input.content.trim()) throw new Error('Skill 内容不能为空。')
  const targetDirectory = join(agentHomes(agent).skillsPath, id)
  await fs.mkdir(targetDirectory, { recursive: true })
  await fs.writeFile(join(targetDirectory, 'SKILL.md'), input.content.trimEnd() + '\n', 'utf8')
}

export async function removeClaudeSkill(agent: AgentAdapterId, id: string): Promise<void> {
  assertAgent(agent)
  await fs.rm(join(agentHomes(agent).skillsPath, safeId(id)), { recursive: true, force: true })
}

export async function saveClaudeMcp(agent: AgentAdapterId, input: SaveClaudeMcpInput): Promise<void> {
  assertAgent(agent)
  if (agent === 'pi') throw new Error('Pi 不支持 MCP 服务。')
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

export async function removeClaudeMcp(agent: AgentAdapterId, name: string, scope: 'user' | 'project', projectPath?: string): Promise<void> {
  assertAgent(agent)
  if (agent === 'pi') throw new Error('Pi 不支持 MCP 服务。')
  const config = await readJson(claudeConfigPath)
  if (scope === 'user' && isObject(config.mcpServers)) delete config.mcpServers[safeId(name)]
  if (scope === 'project' && projectPath && isObject(config.projects) && isObject(config.projects[projectPath])) {
    const project = config.projects[projectPath]
    if (isObject(project.mcpServers)) delete project.mcpServers[safeId(name)]
  }
  await writeJsonAtomic(claudeConfigPath, config)
}

export async function runClaudePluginAction(agent: AgentAdapterId, action: ClaudePluginAction, id: string): Promise<void> {
  assertAgent(agent)
  if (agent === 'pi') throw new Error('Pi 不提供插件机制。')
  if (!['enable', 'disable', 'update', 'uninstall'].includes(action)) throw new Error('不支持的插件操作。')
  if (!/^[\w.-]+@[\w.-]+$/.test(id)) throw new Error('插件标识无效。')
  try {
    await execFileAsync('claude', ['plugin', action, id], { timeout: 60_000, maxBuffer: 1_000_000 })
  } catch (error) {
    const detail = error as { stderr?: string; message?: string }
    throw new Error(detail.stderr?.trim() || detail.message || 'Claude CLI 未能完成插件操作。')
  }
}

export async function revealClaudePath(agent: AgentAdapterId, path: string): Promise<void> {
  assertAgent(agent)
  const error = await shell.openPath(safeClaudePath(path, agentHomes(agent).root))
  if (error) throw new Error(error)
}
