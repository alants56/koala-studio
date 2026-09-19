import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { App, Button, Empty, Input, Modal, Select, Skeleton, Tooltip } from 'antd'
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  FolderOutlined,
  InboxOutlined,
  MessageOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Conversation } from '@shared/conversations'
import type { ArchivedSessionMeta } from '@shared/session-meta-store'
import type { Project } from '@/models'
import { useConversations } from '@/state/ConversationsContext'
import { useProjects } from '@/state/ProjectsContext'
import { dispatchSessionMetaChange } from '@/utils/session-events'
import { readableIpcError } from '@/utils/ipc-error'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

interface SettingsNavItem {
  key: string
  label: string
  icon: ReactElement
}

interface SettingsNavGroup {
  key: string
  label: string
  items: SettingsNavItem[]
}

/** 设置导航：目前只有「已归档的会话管理」，后续设置项按分组往这里加。 */
const SETTINGS_NAV: SettingsNavGroup[] = [
  {
    key: 'archived',
    label: '已归档',
    items: [{ key: 'archived-sessions', label: '已归档的会话管理', icon: <InboxOutlined /> }]
  }
]

/** 仅对话分组的 key；用于「所属项目」筛选。 */
const CONVERSATIONS_GROUP = 'conversations'

interface ArchivedSessionEntry {
  kind: 'session'
  key: string
  title: string
  archivedAt: string
  /** 所属项目；工作目录已经没有对应项目（项目被删除）时为空。 */
  project?: Project
  cwd: string
  sessionId: string
}

interface ArchivedConversationEntry {
  kind: 'conversation'
  key: string
  title: string
  archivedAt: string
  conversation: Conversation
}

type ArchivedEntry = ArchivedSessionEntry | ArchivedConversationEntry

interface ArchivedGroup {
  id: string
  name: string
  kind: ArchivedEntry['kind']
  entries: ArchivedEntry[]
}

function projectGroupId(projectId: string): string {
  return `project:${projectId}`
}

/** 工作目录的展示名：取最后一段（项目已被删除时用来兜底分组）。 */
function workspaceLabel(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).pop() ?? cwd
}

function groupIdOf(entry: ArchivedEntry): string {
  if (entry.kind === 'conversation') return CONVERSATIONS_GROUP
  return entry.project ? projectGroupId(entry.project.id) : `cwd:${entry.cwd}`
}

function groupNameOf(entry: ArchivedEntry): string {
  if (entry.kind === 'conversation') return '仅对话'
  return entry.project?.name ?? workspaceLabel(entry.cwd)
}

/** 归档列表的日期格式：2026年7月27日, 0:59（年份完整、小时不补零，与设计稿一致）。 */
function formatArchivedAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso || '时间未知'
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日, ${date.getHours()}:${minutes}`
}

/**
 * 把本地归档索引映射成列表条目。
 * 同一个工作目录可能被多个项目引用（例如都回退到默认工作区），每个项目各显示一份。
 */
function toSessionEntries(metas: ArchivedSessionMeta[], projects: Project[], defaultWorkspace: string): ArchivedSessionEntry[] {
  const owners = new Map<string, Project[]>()
  for (const project of projects) {
    const cwd = project.path ?? defaultWorkspace
    owners.set(cwd, [...(owners.get(cwd) ?? []), project])
  }

  const entries: ArchivedSessionEntry[] = []
  for (const meta of metas) {
    const title = meta.title || '未命名会话'
    const matched = owners.get(meta.cwd) ?? []
    if (matched.length === 0) {
      entries.push({
        kind: 'session',
        key: `session:${meta.cwd}:${meta.sessionId}`,
        title,
        archivedAt: meta.archivedAt,
        cwd: meta.cwd,
        sessionId: meta.sessionId
      })
      continue
    }
    for (const project of matched) {
      entries.push({
        kind: 'session',
        key: `session:${project.id}:${meta.cwd}:${meta.sessionId}`,
        title,
        archivedAt: meta.archivedAt,
        project,
        cwd: meta.cwd,
        sessionId: meta.sessionId
      })
    }
  }
  return entries
}

/**
 * 设置弹窗：左侧设置导航 + 右侧设置面板（参考桌面端设置的两栏布局）。
 *
 * 目前只有一个设置项「已归档的会话管理」：把项目会话与仅对话两类归档记录统一列出，
 * 支持按关键词 / 类型 / 所属项目筛选，并在这里取消归档或彻底删除。
 */
export function SettingsDialog({ open, onClose }: SettingsDialogProps): ReactElement {
  const { projects, defaultWorkspace } = useProjects()
  const { conversations, setConversationArchived, deleteConversation } = useConversations()
  const { modal, message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()

  const [activeSetting, setActiveSetting] = useState('archived-sessions')
  const [navQuery, setNavQuery] = useState('')
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'session' | 'conversation'>('all')
  const [groupFilter, setGroupFilter] = useState('all')
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSessionMeta[]>([])
  const [loading, setLoading] = useState(false)

  const routeParts = location.pathname.split('/')
  const activeProjectId = location.pathname.startsWith('/projects/') ? decodeURIComponent(routeParts[2] ?? '') : undefined
  const activeConversationId = location.pathname.startsWith('/chats/') ? decodeURIComponent(routeParts[2] ?? '') : undefined
  const activeSessionId = new URLSearchParams(location.search).get('session') ?? undefined

  /**
   * 老数据（引入标题快照之前归档的会话）没有可展示的标题：
   * 先用「未命名会话」渲染，再按目录拉一次 session/list 补上；主进程会顺手把快照写回本地索引，
   * 所以同一批数据只会走一次慢路径。
   */
  const enrichMissingTitles = useCallback(async (entries: ArchivedSessionMeta[]): Promise<void> => {
    const missingCwds = [...new Set(entries.filter((entry) => !entry.title).map((entry) => entry.cwd))]
    if (missingCwds.length === 0) return

    const titles = new Map<string, string>()
    for (const cwd of missingCwds) {
      try {
        for (const session of await window.acp.listSessions(cwd)) {
          if (session.title) titles.set(`${cwd}\u0000${session.sessionId}`, session.title)
        }
      } catch {
        // 补齐失败就继续显示「未命名会话」，不影响取消归档与删除。
      }
    }
    if (titles.size === 0) return
    setArchivedSessions((current) => current.map((entry) => entry.title
      ? entry
      : { ...entry, title: titles.get(`${entry.cwd}\u0000${entry.sessionId}`) ?? entry.title }))
  }, [])

  /**
   * 归档列表读主进程的本地索引（单个 JSON 文件），不逐个项目启动 Agent 拉 session/list，
   * 所以打开弹窗立刻就有内容。
   */
  const loadArchivedSessions = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const entries = await window.acp.listArchivedSessions()
      setArchivedSessions(entries)
      void enrichMissingTitles(entries)
    } catch {
      setArchivedSessions([])
    } finally {
      setLoading(false)
    }
  }, [enrichMissingTitles])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setKindFilter('all')
    setGroupFilter('all')
  }, [open])

  useEffect(() => {
    if (!open) return
    void loadArchivedSessions()
  }, [open, loadArchivedSessions])

  const sessionEntries = useMemo(
    () => toSessionEntries(archivedSessions, projects, defaultWorkspace),
    [archivedSessions, defaultWorkspace, projects]
  )

  const conversationEntries = useMemo<ArchivedConversationEntry[]>(
    () => conversations
      .filter((conversation) => conversation.archivedAt)
      .map((conversation) => ({
        kind: 'conversation',
        key: `conversation:${conversation.id}`,
        title: conversation.title || '新对话',
        archivedAt: conversation.archivedAt ?? conversation.updatedAt,
        conversation
      })),
    [conversations]
  )

  const groupOptions = useMemo(
    () => [
      { value: 'all', label: '所有项目' },
      ...projects.map((project) => ({ value: projectGroupId(project.id), label: project.name })),
      { value: CONVERSATIONS_GROUP, label: '仅对话' }
    ],
    [projects]
  )

  const groups = useMemo<ArchivedGroup[]>(() => {
    const keyword = query.trim().toLowerCase()
    const entries: ArchivedEntry[] = [...sessionEntries, ...conversationEntries]
    const filtered = entries.filter((entry) => {
      if (kindFilter !== 'all' && entry.kind !== kindFilter) return false
      if (groupFilter !== 'all' && groupIdOf(entry) !== groupFilter) return false
      if (keyword && !entry.title.toLowerCase().includes(keyword)) return false
      return true
    })

    const collected = new Map<string, ArchivedGroup>()
    for (const entry of filtered) {
      const id = groupIdOf(entry)
      const group = collected.get(id) ?? { id, name: groupNameOf(entry), kind: entry.kind, entries: [] }
      group.entries.push(entry)
      collected.set(id, group)
    }

    return [...collected.values()]
      .map((group) => ({
        ...group,
        // 分组内按归档时间排序，分组之间也按最新一条排序。
        entries: [...group.entries].sort((a, b) => b.archivedAt.localeCompare(a.archivedAt))
      }))
      .sort((a, b) => (b.entries[0]?.archivedAt ?? '').localeCompare(a.entries[0]?.archivedAt ?? ''))
  }, [conversationEntries, groupFilter, kindFilter, query, sessionEntries])

  const visibleNavGroups = useMemo(() => {
    const keyword = navQuery.trim().toLowerCase()
    if (!keyword) return SETTINGS_NAV
    return SETTINGS_NAV
      .map((group) => ({ ...group, items: group.items.filter((item) => item.label.toLowerCase().includes(keyword)) }))
      .filter((group) => group.items.length > 0)
  }, [navQuery])

  /** 同一工作目录可能被多个项目引用：按目录 + 会话 id 清掉所有重复行。 */
  const removeSessionEntries = (entry: ArchivedSessionEntry): void => {
    setArchivedSessions((current) => current.filter((item) => !(
      item.cwd === entry.cwd && item.sessionId === entry.sessionId
    )))
  }

  /** 取消归档：两类记录都只清标记，不删除任何数据。 */
  const restoreEntry = async (entry: ArchivedEntry): Promise<void> => {
    try {
      if (entry.kind === 'session') {
        await window.acp.setSessionArchived(entry.cwd, entry.sessionId, false)
        removeSessionEntries(entry)
        dispatchSessionMetaChange({ cwd: entry.cwd })
      } else {
        await setConversationArchived(entry.conversation.id, false)
      }
      void message.success('已取消归档')
    } catch (error) {
      void message.error(readableIpcError(error, '取消归档失败'))
    }
  }

  /** 删除：项目会话从 Agent 侧删除记录，仅对话只移除本地索引（目录与产物保留）。 */
  const removeEntry = (entry: ArchivedEntry): void => {
    const isSession = entry.kind === 'session'
    modal.confirm({
      title: isSession ? '删除会话' : '删除对话',
      content: isSession
        ? `确定删除「${entry.title}」吗？会话记录会一并从 Agent 删除，无法恢复。`
        : `确定删除「${entry.title}」吗？删除后无法在列表中恢复，本地目录与产物会保留。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        if (entry.kind === 'conversation') {
          try {
            await deleteConversation(entry.conversation.id)
          } catch (error) {
            void message.error(readableIpcError(error, '删除对话失败'))
            throw error
          }
          if (activeConversationId === entry.conversation.id) void navigate('/projects')
          void message.success('对话已删除')
          return
        }

        try {
          // 主进程会先试 Agent 侧 session/delete，再清本地索引；Agent 侧失败（目录已删除等）不阻塞本地清理。
          const result = await window.acp.deleteSession(entry.cwd, entry.sessionId)
          removeSessionEntries(entry)
          dispatchSessionMetaChange({ cwd: entry.cwd })
          // 删掉的正是当前打开的会话时，退回项目页（留在原地只会看到已删除的会话）。
          if (entry.project && activeProjectId === entry.project.id && activeSessionId === entry.sessionId) {
            void navigate(`/projects/${encodeURIComponent(entry.project.id)}`)
          }
          if (result.agentDeleted) void message.success('会话已删除')
          else void message.warning(`会话已从归档列表移除，但 Agent 侧记录未能删除：${result.warning}`)
        } catch (error) {
          // 本地索引写入失败：保留列表行，用户可以重试。
          void message.error(readableIpcError(error, '删除会话失败'))
          throw error
        }
      }
    })
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      centered
      width={980}
      closable={false}
      destroyOnHidden
      className="koala-settings-dialog"
      styles={{ body: { padding: 0 } }}
    >
      <div className="koala-settings-shell">
        <aside className="koala-settings-nav" aria-label="设置导航">
          <button type="button" className="koala-settings-back" onClick={onClose}>
            <ArrowLeftOutlined />
            <span>返回应用</span>
          </button>
          <Input
            className="koala-settings-nav-search"
            size="small"
            allowClear
            variant="filled"
            prefix={<SearchOutlined />}
            placeholder="搜索设置"
            aria-label="搜索设置"
            value={navQuery}
            onChange={(event) => setNavQuery(event.target.value)}
          />
          <div className="koala-settings-nav-scroll">
            {visibleNavGroups.length === 0 ? (
              <span className="koala-settings-nav-empty">没有匹配的设置</span>
            ) : visibleNavGroups.map((group) => (
              <div className="koala-settings-nav-group" key={group.key}>
                <span className="koala-settings-nav-label">{group.label}</span>
                {group.items.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    className={`koala-settings-nav-item${activeSetting === item.key ? ' is-active' : ''}`}
                    onClick={() => setActiveSetting(item.key)}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>

        <section className="koala-settings-panel" aria-label="已归档的会话管理">
          <header className="koala-settings-panel-head">
            <h2 className="koala-settings-panel-title">已归档的会话管理</h2>
            <p className="koala-settings-panel-caption">
              归档只影响侧栏展示：取消归档会恢复显示，删除会连同 Agent 侧的会话记录一起移除。
            </p>
          </header>

          <div className="koala-archived-toolbar">
            <Input
              className="koala-archived-search"
              allowClear
              prefix={<SearchOutlined />}
              placeholder="搜索已归档会话"
              aria-label="搜索已归档会话"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Select
              className="koala-archived-filter"
              value={kindFilter}
              aria-label="筛选会话类型"
              onChange={setKindFilter}
              options={[
                { value: 'all', label: '全部会话' },
                { value: 'session', label: '项目会话' },
                { value: 'conversation', label: '仅对话' }
              ]}
            />
            <Select
              className="koala-archived-filter"
              value={groupFilter}
              aria-label="筛选所属项目"
              onChange={setGroupFilter}
              options={groupOptions}
            />
          </div>

          <div className="koala-archived-list">
            {loading && archivedSessions.length === 0 ? (
              <Skeleton className="koala-archived-loading" active title={false} paragraph={{ rows: 4 }} />
            ) : groups.length === 0 ? (
              <Empty
                className="koala-archived-empty"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={archivedSessions.length === 0 && conversationEntries.length === 0
                  ? '暂无已归档的会话'
                  : '没有符合筛选条件的会话'}
              />
            ) : groups.map((group) => (
              <div className="koala-archived-group" key={group.id}>
                <div className="koala-archived-group-head">
                  {group.kind === 'conversation' ? <MessageOutlined /> : <FolderOutlined />}
                  <span className="koala-archived-group-name" title={group.name}>{group.name}</span>
                  <span className="koala-archived-group-count">{`${group.entries.length} 个会话`}</span>
                </div>
                {group.entries.map((entry) => (
                  <div className="koala-archived-row" key={entry.key}>
                    <div className="koala-archived-row-main">
                      <span className="koala-archived-row-title" title={entry.title}>{entry.title}</span>
                      <span className="koala-archived-row-date">{formatArchivedAt(entry.archivedAt)}</span>
                    </div>
                    <Tooltip title="删除">
                      <Button
                        className="koala-archived-row-delete"
                        type="text"
                        size="small"
                        icon={<DeleteOutlined />}
                        aria-label={`删除「${entry.title}」`}
                        onClick={() => removeEntry(entry)}
                      />
                    </Tooltip>
                    <Button
                      className="koala-archived-row-restore"
                      size="small"
                      onClick={() => void restoreEntry(entry)}
                    >
                      取消归档
                    </Button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </Modal>
  )
}
