import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentAdapterId, PromptRequest } from '../../shared/acp'

export interface StoredQueuedPrompt {
  id: string
  request: PromptRequest
  displayed?: boolean
}

interface QueuedPromptRecord {
  agentId: AgentAdapterId
  cwd: string
  sessionId: string
  items: StoredQueuedPrompt[]
  updatedAt: string
}

export class QueuedPromptStore {
  private cache?: QueuedPromptRecord[]
  private cacheMtimeMs?: number
  private mutation = Promise.resolve()

  constructor(private readonly file: string) {}

  private async readAll(): Promise<QueuedPromptRecord[]> {
    await this.mutation
    try {
      const stats = await fs.stat(this.file)
      if (this.cache && this.cacheMtimeMs === stats.mtimeMs) return this.cache
      const parsed: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'))
      this.cache = Array.isArray(parsed) ? parsed as QueuedPromptRecord[] : []
      this.cacheMtimeMs = stats.mtimeMs
    } catch {
      this.cache = []
      this.cacheMtimeMs = undefined
    }
    return this.cache
  }

  private async writeAll(records: QueuedPromptRecord[]): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true })
    const temporaryFile = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(temporaryFile, JSON.stringify(records, null, 2), 'utf8')
    await fs.rename(temporaryFile, this.file)
    this.cache = records
    this.cacheMtimeMs = undefined
  }

  async get(agentId: AgentAdapterId, cwd: string, sessionId: string): Promise<StoredQueuedPrompt[]> {
    const records = await this.readAll()
    const record = records.find((item) => item.agentId === agentId && item.cwd === cwd && item.sessionId === sessionId)
    return structuredClone(record?.items ?? [])
  }

  async replace(agentId: AgentAdapterId, cwd: string, sessionId: string, items: StoredQueuedPrompt[]): Promise<void> {
    const operation = this.mutation.then(async () => {
      let records: QueuedPromptRecord[]
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'))
        records = Array.isArray(parsed) ? parsed as QueuedPromptRecord[] : []
      } catch {
        records = []
      }

      const otherRecords = records.filter((item) => !(item.agentId === agentId && item.cwd === cwd && item.sessionId === sessionId))
      const next = items.length > 0
        ? [...otherRecords, { agentId, cwd, sessionId, items: structuredClone(items), updatedAt: new Date().toISOString() }]
        : otherRecords
      await this.writeAll(next)
    })
    this.mutation = operation.catch(() => undefined)
    await operation
  }

  async countBySession(agentId: AgentAdapterId, cwd: string): Promise<Map<string, number>> {
    const records = await this.readAll()
    return new Map(records
      .filter((item) => item.agentId === agentId && item.cwd === cwd && item.items.length > 0)
      .map((item) => [item.sessionId, item.items.length]))
  }
}

let store: QueuedPromptStore | undefined

export function getQueuedPromptStore(): QueuedPromptStore {
  store ??= new QueuedPromptStore(join(app.getPath('userData'), 'queued-prompts.json'))
  return store
}
