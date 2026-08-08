import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  DownOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  MessageOutlined,
  UpOutlined
} from '@ant-design/icons'
import { Skeleton } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AcpSessionInfo, Project } from '@/models'
import { useProjects } from '@/state/ProjectsContext'
import { WORKSPACE_PATH } from '@/utils/constants'
import { subscribeSessionActivity } from '@/utils/session-events'

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
  const { projects, loading } = useProjects()
  const location = useLocation()
  const navigate = useNavigate()
  const [showAllProjects, setShowAllProjects] = useState(false)
  const [expandedSessionLists, setExpandedSessionLists] = useState<Set<string>>(() => new Set())
  const [sessionLists, setSessionLists] = useState<Record<string, SessionListState>>({})
  const [liveSelection, setLiveSelection] = useState<{ projectId: string; sessionId: string }>()
  const sessionListsRef = useRef(sessionLists)
  const requestVersionsRef = useRef(new Map<string, number>())
  const pendingSessionsRef = useRef(new Map<string, AcpSessionInfo>())

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

  const refreshProjectSessions = useCallback(async (project: Project): Promise<void> => {
    const requestVersion = (requestVersionsRef.current.get(project.id) ?? 0) + 1
    requestVersionsRef.current.set(project.id, requestVersion)
    try {
      let sessions = await window.acp.listSessions(project.path ?? WORKSPACE_PATH)
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
  }, [updateSessionLists])

  useEffect(() => {
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
  }, [refreshProjectSessions, visibleProjectKey])

  useEffect(() => {
    return subscribeSessionActivity((activity) => {
      const activeProject = projects.find((project) => project.id === activeProjectId)
      const project = activeProject && (activeProject.path ?? WORKSPACE_PATH) === activity.cwd
        ? activeProject
        : projects.find((item) => (item.path ?? WORKSPACE_PATH) === activity.cwd)
      if (!project) return

      if (activity.phase === 'completed') {
        void refreshProjectSessions(project)
        return
      }

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
  }, [activeProjectId, projects, refreshProjectSessions, updateSessionLists])

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

  return (
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
              <button
                type="button"
                className={`koala-project-row${projectSelected ? ' is-active' : ''}`}
                onClick={() => openProject(project)}
                title={project.name}
              >
                {projectSelected ? <FolderOpenOutlined /> : <FolderOutlined />}
                <span>{project.name}</span>
              </button>

              <div className="koala-session-tree">
                {!state || state.status === 'loading' ? (
                  <span className="koala-session-status">正在读取会话...</span>
                ) : state.status === 'error' ? (
                  <span className="koala-session-status">会话读取失败</span>
                ) : state.sessions.length === 0 ? (
                  <span className="koala-session-status">暂无会话</span>
                ) : (
                  <>
                    {sessions.map((session) => (
                      <button
                        type="button"
                        className={`koala-session-row${projectRouteActive && effectiveActiveSessionId === session.sessionId ? ' is-active' : ''}`}
                        key={session.sessionId}
                        onClick={() => void navigate(`/projects/${encodeURIComponent(project.id)}?session=${encodeURIComponent(session.sessionId)}`)}
                        title={session.title || '未命名会话'}
                      >
                        <MessageOutlined />
                        <span>{session.title || '未命名会话'}</span>
                      </button>
                    ))}
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
  )
}
