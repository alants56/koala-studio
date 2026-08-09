import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { CreateTodoInput, ReorderTodoInput, TodoColumnId, TodoItem, TodoListInput, TodoListResult, UpdateTodoInput } from './todos'

function isTodoColumnId(value: unknown): value is TodoColumnId {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 80
}

export class TodoStore {
  private cache?: TodoItem[]
  private cacheMtimeMs?: number

  constructor(private readonly file: string) {}

  private async readAll(): Promise<TodoItem[]> {
    try {
      const stats = await fs.stat(this.file)
      if (this.cache && this.cacheMtimeMs === stats.mtimeMs) return this.cache
      const parsed: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'))
      this.cache = Array.isArray(parsed) ? parsed as TodoItem[] : []
      this.cacheMtimeMs = stats.mtimeMs
    } catch {
      this.cache = []
      this.cacheMtimeMs = undefined
    }
    return this.cache
  }

  private async writeAll(items: TodoItem[]): Promise<void> {
    this.cache = items
    await fs.mkdir(dirname(this.file), { recursive: true })
    const temporaryFile = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(temporaryFile, JSON.stringify(items, null, 2), 'utf8')
    await fs.rename(temporaryFile, this.file)
    this.cacheMtimeMs = undefined
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
    const items = await this.readAll()
    const columnId = input.columnId?.trim() || 'backlog'
    if (!isTodoColumnId(columnId)) throw new Error('待办类型无效。')
    const requestedPosition = input.position ?? 0
    if (!Number.isInteger(requestedPosition) || requestedPosition < 0) throw new Error('待办位置无效。')
    const columnItems = items
      .filter((item) => item.columnId === columnId)
      .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
    const position = Math.min(requestedPosition, columnItems.length)
    const normalizedPositions = new Map(columnItems.map((item, index) => [item.id, index < position ? index : index + 1]))
    const todo: TodoItem = { id: randomUUID(), title, done: false, important: input.important ?? false, columnId, position, projectId: input.projectId?.trim() || undefined, sessionId: input.sessionId?.trim() || undefined, sessionTitle: input.sessionTitle?.trim() || undefined, createdAt: now, updatedAt: now }
    const shiftedItems = items.map((item) => normalizedPositions.has(item.id) ? { ...item, position: normalizedPositions.get(item.id)! } : item)
    await this.writeAll([todo, ...shiftedItems])
    return todo
  }

  async update(id: string, input: UpdateTodoInput): Promise<TodoItem> {
    const current = await this.get(id)
    const title = input.title === undefined ? current.title : input.title.trim()
    if (!title) throw new Error('待办内容不能为空。')
    const columnId = input.columnId?.trim() || current.columnId
    if (!isTodoColumnId(columnId)) throw new Error('待办类型无效。')
    const updated: TodoItem = { ...current, ...input, title, columnId, updatedAt: new Date().toISOString() }
    return this.replace(updated)
  }

  async reorder(placements: ReorderTodoInput[]): Promise<TodoItem[]> {
    if (!placements.length) return []
    const placementById = new Map(placements.map((placement) => [placement.id, placement]))
    if (placementById.size !== placements.length) throw new Error('待办排序中包含重复 ID。')
    if (placements.some((placement) => !isTodoColumnId(placement.columnId) || !Number.isInteger(placement.position) || placement.position < 0)) {
      throw new Error('待办排序数据无效。')
    }
    const items = await this.readAll()
    const missing = placements.find((placement) => !items.some((item) => item.id === placement.id))
    if (missing) throw new Error(`未找到待办「${missing.id}」。`)
    const now = new Date().toISOString()
    const next = items.map((item) => {
      const placement = placementById.get(item.id)
      return placement ? { ...item, columnId: placement.columnId, position: placement.position, updatedAt: now } : item
    })
    await this.writeAll(next)
    return placements.map((placement) => next.find((item) => item.id === placement.id)!)
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
