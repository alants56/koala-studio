import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  InboxOutlined,
  LoadingOutlined,
  MessageOutlined,
  MoreOutlined,
  PlusOutlined,
  ProjectOutlined,
  UndoOutlined,
  UpOutlined
} from '@ant-design/icons'
import { App, Button, Dropdown, Skeleton } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Conversation } from '@shared/conversations'
import type { AcpSessionInfo, AgentState, Project } from '@/models'
import { RenameProjectModal } from '@/components/projects/RenameProjectModal'
import { RenameSessionModal } from '@/components/layout/RenameSessionModal'
import { useAgentSelection } from '@/state/AgentSelectionContext'
import { useConversations } from '@/state/ConversationsContext'
import { useProjects } from '@/state/ProjectsContext'
import { subscribeSessionActivity, subscribeSessionMetaChange } from '@/utils/session-events'
import { readableIpcError } from '@/utils/ipc-error'

const DEFAULT_VISIBLE_COUNT = 5

/** 侧栏点项目名的建会话请求号：自增，让项目页能区分每一次点击。 */
let newSessionRequestId = 0

type SessionListState =
  | { status: 'loading'; sessions: AcpSessionInfo[] }
  | { status: 'ready'; sessions: AcpSessionInfo[] }
  | { status: 'error'; sessions: AcpSessionInfo[] }

interface ProjectNavigationProps {
  collapsed: boolean
}

/** 侧栏项目树与仅对话：沿用项目页排序，并为每个可见项目展示最近的会话。 */
export function ProjectNavigation({ collapsed }: ProjectNavigationProps): ReactElement | null {
  const { projects, loading, defaultWorkspace, deleteProject } = useProjects()
  const { conversations, loading: conversationsLoading, createConversation, updateConversation, setConversationArchived, deleteConversation } = useConversations()
  const { revision: agentRevision, currentAgent } = useAgentSelection()
  const { modal, message } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [renamingProject, setRenamingProject] = useState<Project>()
  /** 正在重命名的项目会话 / 对话；为空表示弹窗关闭。 */
  const [renamingSession, setRenamingSession] = useState<{ project: Project; session: AcpSessionInfo }>()
  const [renamingConversation, setRenamingConversation] = useState<Conversation>()
  /** 哪些项目展开了「已归档」分组。 */
  const [expandedArchivedProjects, setExpandedArchivedProjects] = useState<Set<string>>(() => new Set())
  const [showAllProjects, setShowAllProjects] = useState(false)
  const [creatingConversation, setCreatingConversation] = useState(false)
  const [expandedSessionLists, setExpandedSessionLists] = useState<Set<string>>(() => new Set())
  const [sessionLists, setSessionLists] = useState<Record<string, SessionListState>>({})
  const [liveSelection, setLiveSelection] = useState<{ projectId: string; sessionId: string }>()
  /** 正在流式生成的会话 id 集合，用于在侧栏会话行上展示加载圈。 */
  const [streamingSessionIds, setStreamingSessionIds] = useState<Set<string>>(() => new Set())
  const streamingSessionIdsRef = useRef<Set<string>>(streamingSessionIds)
  const sessionListsRef = useRef(sessionLists)
  const requestVersionsRef = useRef(new Map<string, number>())
  const pendingSessionsRef = useRef(new Map<string, AcpSessionInfo>())
  const agentRevisionRef = useRef(agentRevision)

  const routeParts = location.pathname.split('/')
  const activeProjectId = location.pathname.startsWith('/projects/') ? decodeURIComponent(routeParts[2] ?? '') : undefined
  const activeConversationId = location.pathname.startsWith('/chats/') ? decodeURIComponent(routeParts[2] ?? '') : undefined
  const activeSessionId = new URLSearchParams(location.search).get('session') ?? undefined
  const effectiveActiveSessionId = activeSessionId
    ?? (liveSelection && liveSelection.projectId === activeProjectId ? liveSelection.sessionId : undefined)
  const visibleProjects = showAllProjects ? projects : projects.slice(0, DEFAULT_VISIBLE_COUNT)
  const visibleProjectKey = visibleProjects.map((project) => `${project.id}:${project.path ?? ''}`).join('|')

  const updateSessionLists = useCallback((update: (current: Record<string, SessionListState>) => Record<string, SessionListState>): void => {
    setSessionLists((current) => {
      const next = update(current)
      sessionListsRef.current = next
      return next
    })
  }, [])

  /** 标记某个会话是否正在流式生成，驱动侧栏会话行的加载圈。 */
  const markStreaming = useCallback((sessionId: string, streaming: boolean): void => {
    const next = new Set(streamingSessionIdsRef.current)
    if (streaming) next.add(sessionId)
    else next.delete(sessionId)
    streamingSessionIdsRef.current = next
    setStreamingSessionIds(next)
  }, [])

  const refreshProjectSessions = useCallback(async (project: Project): Promise<void> => {
    const requestVersion = (requestVersionsRef.current.get(project.id) ?? 0) + 1
    requestVersionsRef.current.set(project.id, requestVersion)
    try {
      let sessions = await window.acp.listSessions(project.path ?? defaultWorkspace)
      if (requestVersionsRef.current.get(project.id) !== requestVersion) return

      const pending = pendingSessionsRef.current.get(project.id)
      if (pending) {
        const listed = sessions.find((session) => session.sessionId === pending.sessionId)
        if (listed) {
          sessions = sessions.map((session) => session.sessionId === pending.sessionId
            ? { ...session, title: session.title || pending.title }
            : session)
          pendingSessionsRef.current.delete(project.id)
        } else {
          sessions = [pending, ...sessions]
        }
      }
      updateSessionLists((current) => ({ ...current, [project.id]: { status: 'ready', sessions } }))
    } catch {
      if (requestVersionsRef.current.get(project.id) !== requestVersion) return
      const currentSessions = sessionListsRef.current[project.id]?.sessions ?? []
      updateSessionLists((current) => ({
        ...current,
        [project.id]: currentSessions.length > 0
          ? { status: 'ready', sessions: currentSessions }
          : { status: 'error', sessions: [] }
      }))
    }
  }, [defaultWorkspace, updateSessionLists])

  useEffect(() => {
    const agentChanged = agentRevisionRef.current !== agentRevision
    if (agentChanged) {
      agentRevisionRef.current = agentRevision
      for (const projectId of requestVersionsRef.current.keys()) {
        requestVersionsRef.current.set(projectId, (requestVersionsRef.current.get(projectId) ?? 0) + 1)
      }
      pendingSessionsRef.current.clear()
      sessionListsRef.current = {}
      setSessionLists({})
      setLiveSelection(undefined)
      streamingSessionIdsRef.current = new Set()
      setStreamingSessionIds(new Set())
    }

    const missingProjects = visibleProjects.filter((project) => !sessionListsRef.current[project.id])
    if (missingProjects.length === 0) return

    // StrictMode 会重复执行 effect；先同步标记全部请求，避免重复启动 ACP 查询。
    updateSessionLists((current) => {
      const next = { ...current }
      for (const project of missingProjects) next[project.id] = { status: 'loading', sessions: [] }
      return next
    })

    void (async () => {
      // 顺序读取，避免用户一次展开很多项目时同时启动过多短连接。
      for (const project of missingProjects) {
        try {
          await refreshProjectSessions(project)
        } catch {
          // refreshProjectSessions 已将失败状态写回对应项目。
        }
      }
    })()
  }, [agentRevision, refreshProjectSessions, visibleProjectKey])

  useEffect(() => {
    let active = true
    const revisions = new Map<string, number>()
    const applyState = (state: AgentState): void => {
      if (!active || !state.sessionId || state.currentAgent !== currentAgent) return
      if ((state.revision ?? 0) < (revisions.get(state.sessionId) ?? -1)) return
      revisions.set(state.sessionId, state.revision ?? 0)
      if (state.sessionId && typeof state.queueDepth === 'number') {
        updateSessionLists((current) => Object.fromEntries(Object.entries(current).map(([projectId, listState]) => [
          projectId,
          {
            ...listState,
            sessions: listState.sessions.map((session) => session.sessionId === state.sessionId
              ? { ...session, queueDepth: state.queueDepth }
              : session)
          }
        ])))
      }
      const wasStreaming = streamingSessionIdsRef.current.has(state.sessionId)
      markStreaming(state.sessionId, state.status === 'working')
      if (wasStreaming && state.status !== 'working') {
        const completedProject = projects.find((project) => (project.path ?? defaultWorkspace) === state.cwd)
        if (completedProject) void refreshProjectSessions(completedProject)
      }
    }

    const removeState = window.acp.onState(applyState)
    void window.acp.getSessionStates().then((states) => states.forEach(applyState))
    return () => {
      active = false
      removeState()
    }
  }, [currentAgent, agentRevision, defaultWorkspace, markStreaming, projects, refreshProjectSessions, updateSessionLists])

  useEffect(() => {
    return subscribeSessionActivity((activity) => {
      const activeProject = projects.find((project) => project.id === activeProjectId)
      const project = activeProject && (activeProject.path ?? defaultWorkspace) === activity.cwd
        ? activeProject
        : projects.find((item) => (item.path ?? defaultWorkspace) === activity.cwd)
      if (!project) return

      // 发送开始即显示并选中新会话；同时让更早的列表请求失效，避免旧结果覆盖。
      requestVersionsRef.current.set(project.id, (requestVersionsRef.current.get(project.id) ?? 0) + 1)
      // 用户改过名的会话保持自定义标题：发消息不再让首条消息文本盖掉它。
      const existing = sessionListsRef.current[project.id]?.sessions.find((session) => session.sessionId === activity.sessionId)
      const optimisticSession: AcpSessionInfo = {
        sessionId: activity.sessionId,
        title: existing?.titleFromUser ? existing.title : activity.title || '未命名会话',
        updatedAt: new Date().toISOString(),
        cwd: activity.cwd,
        titleFromUser: existing?.titleFromUser,
        archived: existing?.archived
      }
      pendingSessionsRef.current.set(project.id, optimisticSession)
      updateSessionLists((current) => {
        const sessions = current[project.id]?.sessions ?? []
        return {
          ...current,
          [project.id]: {
            status: 'ready',
            sessions: [optimisticSession, ...sessions.filter((session) => session.sessionId !== activity.sessionId)]
          }
        }
      })
      setLiveSelection({ projectId: project.id, sessionId: activity.sessionId })
    })
  }, [activeProjectId, defaultWorkspace, projects, updateSessionLists])

  useEffect(() => subscribeSessionMetaChange(({ cwd }) => {
    // 设置弹窗里取消了归档或删除了会话：重新读取该目录，让侧栏与之一致。
    const project = projects.find((item) => (item.path ?? defaultWorkspace) === cwd)
    if (project) void refreshProjectSessions(project)
  }), [defaultWorkspace, projects, refreshProjectSessions])

  useEffect(() => {
    setLiveSelection(undefined)
  }, [location.key])

  const projectRows = useMemo(
    () => visibleProjects.map((project) => {
      const state = sessionLists[project.id]
      const showAllSessions = expandedSessionLists.has(project.id)
      const sessions = state?.sessions ?? []
      // 已归档的会话从主列表拿掉，仍然保留数据，展开「已归档」时可见。
      const activeSessions = sessions.filter((session) => !session.archived)
      const archivedSessions = sessions.filter((session) => session.archived)
      return {
        project,
        state,
        activeSessions,
        archivedSessions,
        visibleSessions: showAllSessions ? activeSessions : activeSessions.slice(0, DEFAULT_VISIBLE_COUNT),
        showAllSessions
      }
    }),
    [expandedSessionLists, sessionLists, visibleProjectKey]
  )

  if (collapsed) {
    return null
  }

  const toggleSessions = (projectId: string): void => {
    setExpandedSessionLists((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  /** 点项目名 = 进项目并开一代新会话：带上 ?new= 意图，由项目页换算成 sessionGeneration。 */
  const openProject = (project: Project): void => {
    newSessionRequestId += 1
    void navigate(`/projects/${encodeURIComponent(project.id)}?new=${newSessionRequestId}`)
  }

  const openProjects = (): void => {
    void navigate('/projects')
  }

  /** 新建仅对话：目录与索引由主进程创建，随后直接进入该对话。 */
  const createNewConversation = async (): Promise<void> => {
    if (creatingConversation) return
    setCreatingConversation(true)
    try {
      const created = await createConversation()
      void navigate(`/chats/${encodeURIComponent(created.id)}`)
    } catch (error) {
      void message.error(readableIpcError(error, '新建对话失败'))
    } finally {
      setCreatingConversation(false)
    }
  }

  /** 删除一条对话：只移除索引，目录与产物保留在本地。 */
  const removeConversation = (conversation: Conversation): void => {
    modal.confirm({
      title: '删除对话',
      content: `确定删除「${conversation.title}」吗？删除后无法在列表中恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteConversation(conversation.id)
        } catch (error) {
          void message.error(readableIpcError(error, '删除对话失败'))
          throw error
        }
        // 删掉的正是当前打开的对话时，留在原地只会看到 404。
        if (activeConversationId === conversation.id) void navigate('/projects')
      }
    })
  }

  const openBoard = (project: Project): void => {
    void navigate(`/projects/${encodeURIComponent(project.id)}?view=board`)
  }

  const toggleArchivedSessions = (projectId: string): void => {
    setExpandedArchivedProjects((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  /** 重命名项目会话：ACP 协议不提供改名，标题覆写记录在主进程的本地索引里。 */
  const renameProjectSession = async (title: string): Promise<void> => {
    const target = renamingSession
    if (!target) return
    await window.acp.renameSession(target.project.path ?? defaultWorkspace, target.session.sessionId, title)
    updateSessionLists((current) => {
      const listState = current[target.project.id]
      if (!listState) return current
      return {
        ...current,
        [target.project.id]: {
          ...listState,
          sessions: listState.sessions.map((session) => session.sessionId === target.session.sessionId
            ? { ...session, title, titleFromUser: true }
            : session)
        }
      }
    })
    void message.success('会话已重命名')
  }

  /** 归档 / 取消归档项目会话：只改本地索引，不删除 Agent 侧会话记录。 */
  const archiveProjectSession = async (project: Project, session: AcpSessionInfo): Promise<void> => {
    const archived = !session.archived
    try {
      await window.acp.setSessionArchived(project.path ?? defaultWorkspace, session.sessionId, archived, session.title)
      updateSessionLists((current) => {
        const listState = current[project.id]
        if (!listState) return current
        return {
          ...current,
          [project.id]: {
            ...listState,
            sessions: listState.sessions.map((item) => item.sessionId === session.sessionId ? { ...item, archived } : item)
          }
        }
      })
      void message.success(archived ? '会话已归档' : '已取消归档')
    } catch (error) {
      void message.error(readableIpcError(error, archived ? '归档失败' : '取消归档失败'))
    }
  }

  /** 重命名对话。 */
  const renameConversation = async (title: string): Promise<void> => {
    const target = renamingConversation
    if (!target) return
    await updateConversation(target.id, { title })
    void message.success('对话已重命名')
  }

  /** 归档 / 取消归档对话：只改索引标记，目录与产物保留。 */
  const archiveConversation = async (conversation: Conversation): Promise<void> => {
    const archived = !conversation.archivedAt
    try {
      await setConversationArchived(conversation.id, archived)
      void message.success(archived ? '对话已归档' : '已取消归档')
    } catch (error) {
      void message.error(readableIpcError(error, archived ? '归档失败' : '取消归档失败'))
    }
  }

  /** 项目会话行 =「打开会话」按钮 +「⋯」菜单（重命名 / 归档）。 */
  const renderSessionRow = (project: Project, session: AcpSessionInfo): ReactElement => {
    const streaming = streamingSessionIds.has(session.sessionId)
    const sessionTitle = session.title || '未命名会话'
    const active = activeProjectId === project.id && effectiveActiveSessionId === session.sessionId
    return (
      <div className={`koala-session-item${active ? ' is-active' : ''}`} key={session.sessionId}>
        <button
          type="button"
          className={`koala-session-row${streaming ? ' is-streaming' : ''}`}
          onClick={() => void navigate(`/projects/${encodeURIComponent(project.id)}?session=${encodeURIComponent(session.sessionId)}`)}
          title={streaming ? `${sessionTitle}（正在生成）` : sessionTitle}
        >
          {streaming && <LoadingOutlined spin />}
          <span>{sessionTitle}</span>
        </button>
        <Dropdown
          menu={{
            items: [
              { key: 'rename', icon: <EditOutlined />, label: '重命名' },
              {
                key: 'archive',
                icon: session.archived ? <UndoOutlined /> : <InboxOutlined />,
                label: session.archived ? '取消归档' : '归档'
              }
            ],
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation()
              if (key === 'rename') setRenamingSession({ project, session })
              if (key === 'archive') void archiveProjectSession(project, session)
            }
          }}
          trigger={['click']}
        >
          <Button
            className="koala-session-more"
            type="text"
            size="small"
            icon={<MoreOutlined />}
            aria-label={`会话「${sessionTitle}」的更多操作`}
            onClick={(event) => event.stopPropagation()}
          />
        </Dropdown>
      </div>
    )
  }

  /** 对话行 =「打开对话」按钮 +「⋯」菜单（重命名 / 归档 / 删除）。 */
  const renderConversationRow = (conversation: Conversation): ReactElement => {
    const streaming = Boolean(conversation.sessionId && streamingSessionIds.has(conversation.sessionId))
    const title = conversation.title || '新对话'
    const active = activeConversationId === conversation.id
    return (
      <div className={`koala-conversation-item${active ? ' is-active' : ''}`} key={conversation.id}>
        <button
          type="button"
          className={`koala-session-row koala-conversation-row${streaming ? ' is-streaming' : ''}`}
          onClick={() => void navigate(`/chats/${encodeURIComponent(conversation.id)}`)}
          title={streaming ? `${title}（正在生成）` : title}
        >
          {streaming && <LoadingOutlined spin />}
          <span>{title}</span>
        </button>
        <Dropdown
          menu={{
            items: [
              { key: 'rename', icon: <EditOutlined />, label: '重命名' },
              {
                key: 'archive',
                icon: conversation.archivedAt ? <UndoOutlined /> : <InboxOutlined />,
                label: conversation.archivedAt ? '取消归档' : '归档'
              },
              { type: 'divider' },
              { key: 'delete', icon: <DeleteOutlined />, label: '删除对话', danger: true }
            ],
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation()
              if (key === 'rename') setRenamingConversation(conversation)
              if (key === 'archive') void archiveConversation(conversation)
              if (key === 'delete') removeConversation(conversation)
            }
          }}
          trigger={['click']}
        >
          <Button
            className="koala-conversation-more"
            type="text"
            size="small"
            icon={<MoreOutlined />}
            aria-label={`对话「${title}」的更多操作`}
            onClick={(event) => event.stopPropagation()}
          />
        </Dropdown>
      </div>
    )
  }

  const removeProject = (project: Project): void => {
    modal.confirm({
      title: '删除项目',
      content: `确定删除「${project.name}」吗？此操作无法恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteProject(project.id)
        } catch (error) {
          void message.error(readableIpcError(error, '删除项目失败'))
          throw error
        }
        // 删掉的正是当前打开的项目时，留在原地只会看到 404。
        if (activeProjectId === project.id) void navigate('/projects')
      }
    })
  }

  // 已归档的对话不再出现在侧栏，统一在设置弹窗的「已归档的会话管理」里查看与恢复。
  const activeConversations = conversations.filter((conversation) => !conversation.archivedAt)

  return (
    <>
      <nav className="koala-project-navigation" aria-label="项目和对话">
        <div className="koala-project-tree">
          {loading ? (
            <Skeleton className="koala-project-tree-loading" active paragraph={{ rows: 4 }} title={false} />
          ) : projectRows.length === 0 ? (
            <button type="button" className="koala-project-empty" onClick={openProjects}>新建第一个项目</button>
          ) : projectRows.map(({ project, state, activeSessions, archivedSessions, visibleSessions, showAllSessions }) => {
            const projectRouteActive = activeProjectId === project.id
            const projectSelected = projectRouteActive && !effectiveActiveSessionId
            const hasMoreSessions = activeSessions.length > DEFAULT_VISIBLE_COUNT
            const showArchivedSessions = expandedArchivedProjects.has(project.id)
  
            return (
              <div className="koala-project-branch" key={project.id}>
                <div className={`koala-project-row${projectSelected ? ' is-active' : ''}`}>
                  <button
                    type="button"
                    className="koala-project-open"
                    onClick={() => openProject(project)}
                    title={project.name}
                  >
                    {projectSelected ? <FolderOpenOutlined /> : <FolderOutlined />}
                    <span>{project.name}</span>
                  </button>
                  <Dropdown
                    menu={{
                      items: [
                        { key: 'board', icon: <ProjectOutlined />, label: '查看项目看板' },
                        { key: 'rename', icon: <EditOutlined />, label: '重命名' },
                        { type: 'divider' },
                        { key: 'delete', icon: <DeleteOutlined />, label: '删除项目', danger: true }
                      ],
                      onClick: ({ key, domEvent }) => {
                        domEvent.stopPropagation()
                        if (key === 'board') openBoard(project)
                        if (key === 'rename') setRenamingProject(project)
                        if (key === 'delete') removeProject(project)
                      }
                    }}
                    trigger={['click']}
                  >
                    <Button
                      className="koala-project-more"
                      type="text"
                      size="small"
                      icon={<MoreOutlined />}
                      aria-label={`项目「${project.name}」的更多操作`}
                      onClick={(event) => event.stopPropagation()}
                    />
                  </Dropdown>
                </div>
  
                <div className="koala-session-tree">
                  {!state || state.status === 'loading' ? (
                    <span className="koala-session-status">正在读取会话...</span>
                  ) : state.status === 'error' ? (
                    <span className="koala-session-status">会话读取失败</span>
                  ) : state.sessions.length === 0 ? (
                    <span className="koala-session-status">暂无会话</span>
                  ) : (
                    <>
                      {activeSessions.length === 0 && <span className="koala-session-status">暂无会话</span>}
                      {visibleSessions.map((session) => renderSessionRow(project, session))}
                      {hasMoreSessions && (
                        <button type="button" className="koala-tree-more" onClick={() => toggleSessions(project.id)}>
                          {showAllSessions ? <UpOutlined /> : <DownOutlined />}
                          <span>{showAllSessions ? '收起' : '更多'}</span>
                        </button>
                      )}
                      {archivedSessions.length > 0 && (
                        <>
                          <button
                            type="button"
                            className="koala-tree-more koala-archived-more"
                            onClick={() => toggleArchivedSessions(project.id)}
                          >
                            {showArchivedSessions ? <UpOutlined /> : <DownOutlined />}
                            <span>{`已归档 ${archivedSessions.length}`}</span>
                          </button>
                          {showArchivedSessions && archivedSessions.map((session) => renderSessionRow(project, session))}
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
  
        {projects.length > DEFAULT_VISIBLE_COUNT && (
          <button type="button" className="koala-tree-more koala-projects-more" onClick={() => setShowAllProjects((value) => !value)}>
            {showAllProjects ? <UpOutlined /> : <DownOutlined />}
            <span>{showAllProjects ? '收起' : '更多'}</span>
          </button>
        )}

        {/* 仅对话：轻量级项目，每条对话一个自动创建的时间戳目录（不展示给用户）。 */}
        <div className="koala-conversation-tree">
          <div className="koala-conversation-head">
            <div className="koala-conversation-title">
              <MessageOutlined />
              <span>对话</span>
            </div>
            <Button
              className="koala-conversation-add"
              type="text"
              size="small"
              icon={<PlusOutlined />}
              loading={creatingConversation}
              onClick={() => void createNewConversation()}
              aria-label="新建对话"
              title="新建对话"
            />
          </div>
          {conversations.length === 0 ? (
            <span className="koala-session-status">{conversationsLoading ? '正在读取对话...' : '暂无对话'}</span>
          ) : (
            <>
              {activeConversations.length === 0 && <span className="koala-session-status">暂无对话</span>}
              {activeConversations.map((conversation) => renderConversationRow(conversation))}
            </>
          )}
        </div>
      </nav>
    <RenameProjectModal open={Boolean(renamingProject)} project={renamingProject} onClose={() => setRenamingProject(undefined)} />
    <RenameSessionModal
      open={Boolean(renamingSession)}
      heading="重命名会话"
      formName="rename-project-session"
      initialTitle={renamingSession?.session.title ?? ''}
      onSubmit={renameProjectSession}
      onClose={() => setRenamingSession(undefined)}
    />
    <RenameSessionModal
      open={Boolean(renamingConversation)}
      heading="重命名对话"
      formName="rename-conversation"
      initialTitle={renamingConversation?.title ?? ''}
      onSubmit={renameConversation}
      onClose={() => setRenamingConversation(undefined)}
    />
    </>
  )
}
