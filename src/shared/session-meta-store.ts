import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { AcpSessionInfo, AgentAdapterId } from './acp'

/** 单条历史会话在应用内的附加元数据（ACP 协议没有重命名 / 归档，只能本地覆写）。 */
export interface SessionMeta {
  /** 用户自定义标题；存在时优先于 Agent 返回的标题。 */
  title?: string
  /** 归档的会话在侧栏默认收起。 */
  archived?: boolean
  /** 归档时的会话标题快照：归档列表完全本地渲染，不用为读标题启动 Agent。 */
  archivedTitle?: string
  /** 归档时间；取消归档时清除。 */
  archivedAt?: string
  /** 元数据最近修改时间。 */
  updatedAt: string
}

/** 归档会话的展示数据（来自本地索引，不需要连接 Agent）。 */
export interface ArchivedSessionMeta {
  cwd: string
  sessionId: string
  /** 自定义标题 / 归档快照 / 空字符串（旧数据尚未回填时）。 */
  title: string
  archivedAt: string
}

const TITLE_MAX_LENGTH = 120

function normalizedTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX_LENGTH)
}

/**
 * 历史会话（ACP session）的本地元数据索引：自定义标题与归档标记。
 *
 * ACP 没有重命名 / 归档方法，这些覆写只影响应用内的展示，不改动 Agent 侧记录。
 * 放在 shared 层是为了让主进程与测试复用同一套落盘逻辑（不依赖 electron）。
 */
export class SessionMetaStore {
  private cache?: Record<string, SessionMeta>

  constructor(private readonly file: string) {}

  /** 会话按 Agent + 工作目录 + sessionId 定位：不同项目的同名会话互不影响。 */
  private static key(agent: AgentAdapterId, cwd: string, sessionId: string): string {
    return `${agent}\u0000${cwd}\u0000${sessionId}`
  }

  private async readAll(): Promise<Record<string, SessionMeta>> {
    if (this.cache) return this.cache
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.file, 'utf8'))
      this.cache = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, SessionMeta>)
        : {}
    } catch {
      this.cache = {}
    }
    return this.cache
  }

  /** 原子写入：先写临时文件再重命名，避免写一半损坏索引。 */
  private async writeAll(all: Record<string, SessionMeta>): Promise<void> {
    this.cache = all
    await fs.mkdir(dirname(this.file), { recursive: true })
    const temporaryFile = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(temporaryFile, JSON.stringify(all, null, 2), 'utf8')
    await fs.rename(temporaryFile, this.file)
  }

  async get(agent: AgentAdapterId, cwd: string, sessionId: string): Promise<SessionMeta | undefined> {
    return (await this.readAll())[SessionMetaStore.key(agent, cwd, sessionId)]
  }

  /** 重命名：空白标题视为清除自定义标题，回退到 Agent 标题。 */
  async rename(agent: AgentAdapterId, cwd: string, sessionId: string, title: string): Promise<SessionMeta> {
    const normalized = normalizedTitle(title)
    return this.update(agent, cwd, sessionId, (meta) => {
      const next = { ...meta }
      if (normalized) next.title = normalized
      else delete next.title
      return next
    })
  }

  /** 归档 / 取消归档；归档时顺带记下标题快照，供设置弹窗本地展示。 */
  async setArchived(
    agent: AgentAdapterId,
    cwd: string,
    sessionId: string,
    archived: boolean,
    title?: string
  ): Promise<SessionMeta> {
    return this.update(agent, cwd, sessionId, (meta) => {
      const next = { ...meta }
      if (archived) {
        next.archived = true
        next.archivedAt ??= new Date().toISOString()
        const snapshot = title ? normalizedTitle(title) : ''
        if (snapshot) next.archivedTitle = snapshot
      } else {
        delete next.archived
        delete next.archivedAt
        delete next.archivedTitle
      }
      return next
    })
  }

  /**
   * 当前 Agent 的归档列表：只读本地索引，按归档时间倒序。
   * 设置弹窗据此渲染，不用逐个目录启动 Agent 拉 session/list。
   */
  async listArchived(agent: AgentAdapterId): Promise<ArchivedSessionMeta[]> {
    const all = await this.readAll()
    const entries: ArchivedSessionMeta[] = []
    for (const [key, meta] of Object.entries(all)) {
      if (meta.archived !== true) continue
      const [entryAgent, cwd, sessionId] = key.split('\u0000')
      if (entryAgent !== agent || !cwd || !sessionId) continue
      entries.push({
        cwd,
        sessionId,
        title: meta.title ?? meta.archivedTitle ?? '',
        // 旧数据没有独立的归档时间：退回元数据更新时间，至少不会显示为空。
        archivedAt: meta.archivedAt ?? meta.updatedAt
      })
    }
    return entries.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))
  }

  /**
   * 给老数据补标题快照：早期归档没有存档标题，设置弹窗只能显示「未命名会话」。
   * 侧栏拉取 session/list 时顺带把还没存过的标题写回来，之后归档列表就能纯本地渲染。
   */
  async snapshotArchivedTitles(agent: AgentAdapterId, cwd: string, sessions: AcpSessionInfo[]): Promise<void> {
    const all = await this.readAll()
    const copy = { ...all }
    let changed = false
    for (const session of sessions) {
      const snapshot = session.title ? normalizedTitle(session.title) : ''
      if (!snapshot) continue
      const key = SessionMetaStore.key(agent, cwd, session.sessionId)
      const meta = copy[key]
      if (meta?.archived !== true || meta.archivedTitle || meta.title) continue
      copy[key] = { ...meta, archivedTitle: snapshot }
      changed = true
    }
    if (changed) await this.writeAll(copy)
  }

  /** 会话被彻底删除时清掉本地覆写，避免索引里留下指向不存在会话的悬空条目。 */
  async forget(agent: AgentAdapterId, cwd: string, sessionId: string): Promise<void> {
    const all = await this.readAll()
    const key = SessionMetaStore.key(agent, cwd, sessionId)
    if (!(key in all)) return
    const copy = { ...all }
    delete copy[key]
    await this.writeAll(copy)
  }

  /** 把本地覆写合并进 session/list 的结果。 */
  async apply(agent: AgentAdapterId, cwd: string, sessions: AcpSessionInfo[]): Promise<AcpSessionInfo[]> {
    const all = await this.readAll()
    return sessions.map((session) => {
      const meta = all[SessionMetaStore.key(agent, cwd, session.sessionId)]
      // 两个标记始终给出确定值，调用方不用区分「没有元数据」与「标记为 false」。
      return {
        ...session,
        title: meta?.title ?? session.title,
        titleFromUser: meta?.title !== undefined,
        archived: meta?.archived === true
      }
    })
  }

  private async update(
    agent: AgentAdapterId,
    cwd: string,
    sessionId: string,
    updater: (meta: SessionMeta) => SessionMeta
  ): Promise<SessionMeta> {
    const all = await this.readAll()
    const key = SessionMetaStore.key(agent, cwd, sessionId)
    const next = { ...updater(all[key] ?? { updatedAt: '' }), updatedAt: new Date().toISOString() }
    const copy = { ...all }
    // 没有标题也没有归档标记时删掉条目，避免索引里攒下无意义的空记录。
    if (next.title === undefined && next.archived !== true) delete copy[key]
    else copy[key] = next
    await this.writeAll(copy)
    return next
  }
}
