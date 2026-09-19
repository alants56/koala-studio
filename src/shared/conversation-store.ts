import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEFAULT_CONVERSATION_TITLE, type Conversation, type UpdateConversationInput } from './conversations'

const TITLE_MAX_LENGTH = 120

/** 对话目录名：年月日时分秒，例如 20250919143012。 */
export function conversationDirectoryName(date: Date): string {
  const pad = (value: number, length = 2): string => String(value).padStart(length, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('')
}

function normalizedTitle(value: string, fallback: string): string {
  const title = value.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LENGTH)
  return title || fallback
}

/**
 * 仅对话的索引与目录分配。
 *
 * 索引（JSON）与对话目录分开存放：索引在应用数据根目录，对话目录集中在 conversations/ 下。
 * 放在 shared 层是为了让主进程与测试复用同一套落盘逻辑（不依赖 electron）。
 */
export class ConversationStore {
  private cache?: Conversation[]

  constructor(
    private readonly file: string,
    private readonly rootDir: string
  ) {}

  private async readAll(): Promise<Conversation[]> {
    if (this.cache) return this.cache
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'))
      this.cache = Array.isArray(parsed) ? (parsed as Conversation[]) : []
    } catch {
      this.cache = []
    }
    return this.cache
  }

  /** 原子写入：先写临时文件再重命名，避免写一半损坏索引。 */
  private async writeAll(conversations: Conversation[]): Promise<void> {
    this.cache = conversations
    await fs.mkdir(dirname(this.file), { recursive: true })
    const temporaryFile = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(temporaryFile, JSON.stringify(conversations, null, 2), 'utf8')
    await fs.rename(temporaryFile, this.file)
  }

  async list(): Promise<Conversation[]> {
    return [...(await this.readAll())].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(id: string): Promise<Conversation> {
    const conversation = (await this.readAll()).find((item) => item.id === id)
    if (!conversation) throw new Error(`未找到对话「${id}」。`)
    return conversation
  }

  /**
   * 新建对话：目录名取自当前时刻，同一秒内重复创建时追加 -1、-2… 后缀。
   * 目录在连接 ACP 之前必须存在（cwd 必须可用），因此创建记录时一并建目录。
   */
  async create(now = new Date()): Promise<Conversation> {
    const dir = await this.allocateDirectory(now)
    const timestamp = now.toISOString()
    const conversation: Conversation = {
      id: randomUUID(),
      title: DEFAULT_CONVERSATION_TITLE,
      dir,
      createdAt: timestamp,
      updatedAt: timestamp
    }
    await this.writeAll([...(await this.readAll()), conversation])
    return conversation
  }

  update(id: string, input: UpdateConversationInput): Promise<Conversation> {
    return this.replace(id, (current) => ({
      ...current,
      title: input.title === undefined ? current.title : normalizedTitle(input.title, current.title),
      sessionId: input.sessionId?.trim() || current.sessionId,
      agent: input.agent ?? current.agent,
      updatedAt: new Date().toISOString()
    }))
  }

  /** 刷新最近使用时间；不改变标题与会话 id。 */
  touch(id: string): Promise<Conversation> {
    return this.replace(id, (current) => ({ ...current, updatedAt: new Date().toISOString() }))
  }

  /** 归档 / 取消归档：只写 / 清归档标记，不改标题与最近使用时间（归档不应影响排序基准）。 */
  setArchived(id: string, archived: boolean): Promise<Conversation> {
    return this.replace(id, (current) => archived
      ? { ...current, archivedAt: current.archivedAt ?? new Date().toISOString() }
      : { ...current, archivedAt: undefined })
  }

  /** 只从索引移除；对话目录（会话记录与产物）保留在磁盘上。 */
  async delete(id: string): Promise<void> {
    const conversations = await this.readAll()
    const next = conversations.filter((conversation) => conversation.id !== id)
    if (next.length !== conversations.length) await this.writeAll(next)
  }

  private async replace(id: string, update: (current: Conversation) => Conversation): Promise<Conversation> {
    const conversations = await this.readAll()
    const index = conversations.findIndex((conversation) => conversation.id === id)
    if (index === -1) throw new Error(`未找到对话「${id}」。`)
    const updated = update(conversations[index])
    const next = [...conversations]
    next[index] = updated
    await this.writeAll(next)
    return updated
  }

  private async allocateDirectory(date: Date): Promise<string> {
    await fs.mkdir(this.rootDir, { recursive: true })
    const base = conversationDirectoryName(date)
    for (let attempt = 0; ; attempt += 1) {
      const dir = join(this.rootDir, attempt === 0 ? base : `${base}-${attempt}`)
      try {
        // recursive: false 才能用 EEXIST 判断目录名冲突，避免覆盖已有对话目录。
        await fs.mkdir(dir, { recursive: false })
        return dir
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
  }
}
