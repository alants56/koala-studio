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
  SaveClaudeMcpInput,
  SaveClaudeSkillInput
} from '../../shared/claude'

const execFileAsync = promisify(execFile)
const claudeHome = join(homedir(), '.claude')
const skillsPath = join(claudeHome, 'skills')
const pluginsPath = join(claudeHome, 'plugins')
const settingsPath = join(claudeHome, 'settings.json')
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
