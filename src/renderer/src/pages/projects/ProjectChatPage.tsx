import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Result, Spin } from 'antd'
import type { TodoItem } from '@shared/todos'
import { ChatView } from '@/components/chat/ChatView'
import { ProjectBoard } from '@/components/board/ProjectBoard'
import { useProjects } from '@/state/ProjectsContext'
import { AgentProvider } from '@/state/AgentContext'
import { useAgentSelection } from '@/state/AgentSelectionContext'

type ProjectView = 'chat' | 'board'

/** 当前路由目标；被缓存隐藏后要沿用最后一次的值。 */
interface ProjectTarget {
  projectId?: string
  sessionId?: string
  view: ProjectView
}

/**
 * 项目页：对话与看板共存。
 *
 * 两个面板始终挂载、用 CSS 切换显隐：对话面板离开可视区后必须继续接收流式消息，
 * 看板面板则避免每次切会话都丢掉滚动位置和展开状态。看板因此被放在 AgentProvider 之外。
 *
 * 「新建会话」只有一条路径——递增 sessionGeneration 让 AgentProvider 换 key 重挂载，
 * 由它重挂载时的 connect() 建出恰好一个会话。不要再叠加显式的 createNewSession，
 * 两条路径同时生效时会各建一个会话，孤儿化其中一个并白占一个并发名额。
 * 侧栏点项目名带 ?new= 意图进来，同样在这里换算成递增代数，不另开建会话入口。
 */
export function ProjectChatPage(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { getProject, loading, defaultWorkspace } = useProjects()
  const { revision: agentRevision } = useAgentSelection()
  const project = projectId ? getProject(projectId) : undefined
  const projectRouteActive = location.pathname.startsWith('/projects/')
  const routeSessionId = searchParams.get('session') || undefined
  const routeNewSession = searchParams.get('new') || undefined
  const routeView: ProjectView = searchParams.get('view') === 'board' ? 'board' : 'chat'

  const [retainedTarget, setRetainedTarget] = useState<ProjectTarget>({ projectId, sessionId: routeSessionId, view: routeView })

  // 缓存详情被隐藏后，全局 location 会切到其他一级页面；此时不能改写当前会话目标与看板状态。
  useLayoutEffect(() => {
    if (projectRouteActive) setRetainedTarget({ projectId, sessionId: routeSessionId, view: routeView })
  }, [location.key, projectId, projectRouteActive, routeSessionId, routeView])

  const target = projectRouteActive ? { projectId, sessionId: routeSessionId, view: routeView } : retainedTarget
  const boardActive = target.view === 'board'

  /** 会话代数：+1 即让 AgentProvider 重挂载并新建一个会话。 */
  const [sessionGeneration, setSessionGeneration] = useState(0)
  /** 从看板点进来的待办：首条消息发出后挂载到那时实际产生的会话上。 */
  const [pendingTodoId, setPendingTodoId] = useState<string>()

  // 看板只在首次打开后挂载，避免每次进项目页都白读一次待办列表。
  const [boardActivated, setBoardActivated] = useState(boardActive)
  useEffect(() => {
    if (boardActive) setBoardActivated(true)
  }, [boardActive])

  // 用户没发消息就转去了某个历史会话：挂载意图作废，否则会在那个会话里挂错待办。
  useEffect(() => {
    setPendingTodoId(undefined)
  }, [routeSessionId])

  /** 丢弃挂载意图，换一代会话，并回到对话面板。 */
  const beginNewSession = useCallback((todoId?: string): void => {
    setPendingTodoId(todoId)
    setSessionGeneration((value) => value + 1)
    const params = new URLSearchParams(location.search)
    params.delete('session')
    params.delete('view')
    params.delete('new')
    // 从看板点进来时压一条历史，返回键能回到看板；「新对话」则就地重置，不堆历史。
    void navigate({ pathname: location.pathname, search: params.toString() }, { replace: todoId === undefined })
  }, [location.pathname, location.search, navigate])

  const startNewConversation = useCallback((): void => beginNewSession(), [beginNewSession])

  /** 只替换 view，保留 session：从看板回来还停在同一个会话上，且不会触发 AgentProvider 重挂载。 */
  const openBoard = useCallback((): void => {
    const params = new URLSearchParams(location.search)
    params.set('view', 'board')
    void navigate({ pathname: location.pathname, search: params.toString() })
  }, [location.pathname, location.search, navigate])

  // 侧栏点项目名的 ?new= 意图：换算成递增代数（唯一建会话路径）并立刻把它从 URL 摘掉，
  // 这样回退/前进到这条历史时不会重复建会话。location.key 保证 StrictMode 下只处理一次。
  const handledNewSessionRef = useRef<string | undefined>(undefined)
  useLayoutEffect(() => {
    if (!projectRouteActive || !routeNewSession) return
    if (handledNewSessionRef.current === location.key) return
    handledNewSessionRef.current = location.key
    beginNewSession()
  }, [beginNewSession, location.key, projectRouteActive, routeNewSession])

  /** 看板上点了一条还没挂载会话的待办。 */
  const launchTodo = useCallback((todo: TodoItem): void => beginNewSession(todo.id), [beginNewSession])

  const handleFirstPrompt = useCallback((sessionId: string, title: string): void => {
    if (!pendingTodoId) return
    const todoId = pendingTodoId
    setPendingTodoId(undefined)
    void window.todos.update(todoId, { sessionId, sessionTitle: title }).catch(() => undefined)
  }, [pendingTodoId])

  // 项目列表尚未从主进程读取完成时，不能将临时的空列表误判为项目不存在。
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
        <Spin size="large" />
      </div>
    )
  }

  if (!project) {
    return (
      <Result
        status="404"
        title="项目不存在"
        subTitle="未找到该项目，可能已被删除。"
        extra={<Button type="primary" onClick={() => navigate('/projects')}>返回项目列表</Button>}
      />
    )
  }

  const initialSessionId = target.projectId === project.id ? target.sessionId : undefined

  return (
    <>
      <div className={boardActive ? 'koala-route-pane-hidden' : 'koala-route-pane'}>
        <AgentProvider
          key={`${project.id}:${initialSessionId ?? 'new'}:${agentRevision}:${sessionGeneration}`}
          cwd={project.path ?? defaultWorkspace}
          initialSessionId={initialSessionId}
          onFirstPrompt={handleFirstPrompt}
        >
          <ChatView
          title={project.name}
          workspaceName={project.name}
          onStartNewConversation={startNewConversation}
          onOpenBoard={openBoard}
          backTo="/projects"
          backLabel="返回项目列表"
        />
        </AgentProvider>
      </div>
      {boardActivated && (
        <div className={boardActive ? 'koala-route-pane' : 'koala-route-pane-hidden'}>
          <ProjectBoard key={project.id} project={project} onLaunchTodo={launchTodo} />
        </div>
      )}
    </>
  )
}
