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
  return [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function createProject(input: CreateProjectInput): Promise<Project> {
  const projects = await readAll()
  const now = new Date().toISOString()
  const project: Project = {
    id: randomUUID(),
    name: input.name.trim(),
    description: input.description.trim(),
    path: input.path?.trim() || undefined,
    tags: input.tags.map((tag) => tag.trim()).filter(Boolean),
    createdAt: now,
    updatedAt: now
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
