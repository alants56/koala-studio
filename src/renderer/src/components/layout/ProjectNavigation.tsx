import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  DeleteOutlined,
  DownOutlined,
  EditOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  LoadingOutlined,
  MessageOutlined,
  MoreOutlined,
  ProjectOutlined,
  UpOutlined
} from '@ant-design/icons'
import { App, Button, Dropdown, Skeleton } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AcpSessionInfo, AgentState, Project } from '@/models'
import { RenameProjectModal } from '@/components/projects/RenameProjectModal'
import { useAgentSelection } from '@/state/AgentSelectionContext'
import { useProjects } from '@/state/ProjectsContext'
import { subscribeSessionActivity } from '@/utils/session-events'
import { readableIpcError } from '@/utils/ipc-error'

const DEFAULT_VISIBLE_COUNT = 5

type SessionListState =
  | { status: 'loading'; sessions: AcpSessionInfo[] }
  | { status: 'ready'; sessions: AcpSessionInfo[] }
  | { status: 'error'; sessions: AcpSessionInfo[] }

interface ProjectNavigationProps {
  collapsed: boolean
}

/** 侧栏项目树：沿用项目页排序，并为每个可见项目展示最近的会话。 */
export function ProjectNavigation({ collapsed }: ProjectNavigationProps): ReactElement | null {
  const { projects, loading, defaultWorkspace, deleteProject } = useProjects()
  const { revision: agentRevision, currentAgent } = useAgentSelection()
  const { modal, message } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [renamingProject, setRenamingProject] = useState<Project>()
  const [showAllProjects, setShowAllProjects] = useState(false)
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
      const optimisticSession: AcpSessionInfo = {
        sessionId: activity.sessionId,
        title: activity.title || '未命名会话',
        updatedAt: new Date().toISOString(),
        cwd: activity.cwd
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

  useEffect(() => {
    setLiveSelection(undefined)
  }, [location.key])

  const projectRows = useMemo(
    () => visibleProjects.map((project) => {
      const state = sessionLists[project.id]
      const showAllSessions = expandedSessionLists.has(project.id)
      return {
        project,
        state,
        sessions: showAllSessions ? state?.sessions ?? [] : state?.sessions.slice(0, DEFAULT_VISIBLE_COUNT) ?? [],
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

  const openProject = (project: Project): void => {
    void navigate(`/projects/${encodeURIComponent(project.id)}`)
  }

  const openProjects = (): void => {
    void navigate('/projects')
  }

  const openBoard = (project: Project): void => {
    void navigate(`/projects/${encodeURIComponent(project.id)}?view=board`)
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

  return (
    <>
      <nav className="koala-project-navigation" aria-label="项目和会话">
        <div className="koala-project-tree">
          {loading ? (
            <Skeleton className="koala-project-tree-loading" active paragraph={{ rows: 4 }} title={false} />
          ) : projectRows.length === 0 ? (
            <button type="button" className="koala-project-empty" onClick={openProjects}>新建第一个项目</button>
          ) : projectRows.map(({ project, state, sessions, showAllSessions }) => {
            const projectRouteActive = activeProjectId === project.id
            const projectSelected = projectRouteActive && !effectiveActiveSessionId
            const hasMoreSessions = (state?.sessions.length ?? 0) > DEFAULT_VISIBLE_COUNT
  
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
                      {sessions.map((session) => {
                        const streaming = streamingSessionIds.has(session.sessionId)
                        const sessionTitle = session.title || '未命名会话'
                        return (
                          <button
                            type="button"
                            className={`koala-session-row${projectRouteActive && effectiveActiveSessionId === session.sessionId ? ' is-active' : ''}${streaming ? ' is-streaming' : ''}`}
                            key={session.sessionId}
                            onClick={() => void navigate(`/projects/${encodeURIComponent(project.id)}?session=${encodeURIComponent(session.sessionId)}`)}
                            title={streaming ? `${sessionTitle}（正在生成）` : sessionTitle}
                          >
                            {streaming ? <LoadingOutlined spin /> : <MessageOutlined />}
                            <span>{sessionTitle}</span>
                          </button>
                        )
                      })}
                      {hasMoreSessions && (
                        <button type="button" className="koala-tree-more koala-session-more" onClick={() => toggleSessions(project.id)}>
                          {showAllSessions ? <UpOutlined /> : <DownOutlined />}
                          <span>{showAllSessions ? '收起' : '更多'}</span>
                        </button>
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
      </nav>
    <RenameProjectModal open={Boolean(renamingProject)} project={renamingProject} onClose={() => setRenamingProject(undefined)} />
    </>
  )
}
