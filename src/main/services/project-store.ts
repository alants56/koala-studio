import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { CreateProjectInput, Project, UpdateProjectInput } from '../../shared/projects'

const STORE_FILE = 'projects.json'

/** 内存缓存，避免每次读取都走磁盘。 */
let cache: Project[] | undefined

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILE)
}

async function readAll(): Promise<Project[]> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(storePath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    cache = Array.isArray(parsed) ? (parsed as Project[]) : []
  } catch {
    cache = []
  }
  return cache
}

/** 原子写入：先写临时文件再重命名，避免写一半损坏数据。 */
async function writeAll(projects: Project[]): Promise<void> {
  cache = projects
  const file = storePath()
  await fs.writeFile(`${file}.tmp`, JSON.stringify(projects, null, 2), 'utf8')
  await fs.rename(`${file}.tmp`, file)
}

export async function listProjects(): Promise<Project[]> {
  const projects = await readAll()
  // 兼容旧数据：缺 sortOrder 的项目按 updatedAt 倒序补齐，一次落盘后即可手动排序。
  if (projects.some((project) => typeof project.sortOrder !== 'number')) {
    const migrated = [...projects]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((project, index) => ({ ...project, sortOrder: index }))
    await writeAll(migrated)
    return migrated
  }
  return [...projects].sort((a, b) => a.sortOrder - b.sortOrder)
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const projects = await readAll()
  const now = new Date().toISOString()
  // 新项目置顶：排在当前最前面的项目之前。
  const existingOrders = projects.map((project) => project.sortOrder).filter((order): order is number => typeof order === 'number')
  const minOrder = existingOrders.length > 0 ? Math.min(...existingOrders) : 0
  const project: Project = {
    id: randomUUID(),
    name: input.name.trim(),
    description: input.description.trim(),
    path: input.path?.trim() || undefined,
    tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
    createdAt: now,
    updatedAt: now,
    sortOrder: minOrder - 1
  }
  projects.push(project)
  await writeAll(projects)
  return project
}

export async function updateProject(id: string, input: UpdateProjectInput): Promise<Project> {
  const projects = await readAll()
  const index = projects.findIndex((project) => project.id === id)
  if (index === -1) throw new Error('项目不存在')

  const current = projects[index]
  const updated: Project = {
    ...current,
    name: input.name.trim(),
    description: input.description.trim(),
    path: input.path?.trim() || undefined,
    tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
    updatedAt: new Date().toISOString()
  }
  projects[index] = updated
  await writeAll(projects)
  return updated
}

export async function deleteProject(id: string): Promise<void> {
  const projects = await readAll()
  const next = projects.filter((project) => project.id !== id)
  if (next.length !== projects.length) {
    await writeAll(next)
  }
}

/** 按传入的 id 顺序重排所有项目。校验通过后按索引重写 sortOrder。 */
export async function reorderProjects(orderedIds: string[]): Promise<void> {
  const projects = await readAll()
  if (orderedIds.length !== projects.length) {
    throw new Error('项目列表不完整')
  }
  const byId = new Map(projects.map((project) => [project.id, project]))
  for (const id of orderedIds) {
    if (!byId.has(id)) throw new Error('包含不存在的项目')
  }
  const reordered = orderedIds.map((id, index) => ({ ...byId.get(id)!, sortOrder: index }))
  await writeAll(reordered)
}
