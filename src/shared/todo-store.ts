import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { CreateTodoInput, TodoItem, TodoListInput, TodoListResult, UpdateTodoInput } from './todos'

export class TodoStore {
  private cache?: TodoItem[]

  constructor(private readonly file: string) {}

  private async readAll(): Promise<TodoItem[]> {
    if (this.cache) return this.cache
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'))
      this.cache = Array.isArray(parsed) ? parsed as TodoItem[] : []
    } catch {
      this.cache = []
    }
    return this.cache
  }

  private async writeAll(items: TodoItem[]): Promise<void> {
    this.cache = items
    await fs.mkdir(dirname(this.file), { recursive: true })
    const temporaryFile = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(temporaryFile, JSON.stringify(items, null, 2), 'utf8')
    await fs.rename(temporaryFile, this.file)
  }

  async list(input: TodoListInput = {}): Promise<TodoListResult> {
    const status = input.status ?? 'all'
    const query = input.query?.trim().toLowerCase()
    const offset = Math.max(0, input.offset ?? 0)
    const limit = Math.min(100, Math.max(1, input.limit ?? 50))
    const matched = (await this.readAll()).filter((item) => {
      const statusMatch = status === 'all' || (status === 'done' ? item.done : !item.done)
      return statusMatch && (input.important === undefined || item.important === input.important) && (!input.projectId || item.projectId === input.projectId) && (!query || item.title.toLowerCase().includes(query))
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const items = matched.slice(offset, offset + limit)
    return { total: matched.length, count: items.length, offset, hasMore: offset + items.length < matched.length, ...(offset + items.length < matched.length ? { nextOffset: offset + items.length } : {}), items }
  }

  async get(id: string): Promise<TodoItem> {
    const todo = (await this.readAll()).find((item) => item.id === id)
    if (!todo) throw new Error(`未找到待办「${id}」。请先调用 koala_list_todos 获取有效 ID。`)
    return todo
  }

  async create(input: CreateTodoInput): Promise<TodoItem> {
    const title = input.title.trim()
    if (!title) throw new Error('待办内容不能为空。')
    const now = new Date().toISOString()
    const todo: TodoItem = { id: randomUUID(), title, done: false, important: input.important ?? false, projectId: input.projectId?.trim() || undefined, sessionId: input.sessionId?.trim() || undefined, sessionTitle: input.sessionTitle?.trim() || undefined, createdAt: now, updatedAt: now }
    await this.writeAll([todo, ...await this.readAll()])
    return todo
  }

  async update(id: string, input: UpdateTodoInput): Promise<TodoItem> {
    const current = await this.get(id)
    const title = input.title === undefined ? current.title : input.title.trim()
    if (!title) throw new Error('待办内容不能为空。')
    const updated: TodoItem = { ...current, ...input, title, updatedAt: new Date().toISOString() }
    return this.replace(updated)
  }

  async setDone(id: string, done: boolean): Promise<TodoItem> {
    return this.update(id, { done })
  }

  async delete(id: string): Promise<void> {
    const current = await this.readAll()
    const next = current.filter((item) => item.id !== id)
    if (current.length === next.length) throw new Error(`未找到待办「${id}」。请先调用 koala_list_todos 获取有效 ID。`)
    await this.writeAll(next)
  }

  private async replace(updated: TodoItem): Promise<TodoItem> {
    const items = await this.readAll()
    const index = items.findIndex((item) => item.id === updated.id)
    if (index === -1) throw new Error(`未找到待办「${updated.id}」。`)
    items[index] = updated
    await this.writeAll(items)
    return updated
  }
}
