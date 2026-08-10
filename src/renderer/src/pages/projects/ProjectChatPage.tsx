import { useLayoutEffect, useState, type ReactElement } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Result, Spin } from 'antd'
import { ChatView } from '@/components/chat/ChatView'
import { useProjects } from '@/state/ProjectsContext'
import { AgentProvider } from '@/state/AgentContext'
import { useAgentSelection } from '@/state/AgentSelectionContext'
import { WORKSPACE_PATH } from '@/utils/constants'

/** 项目对话页：进入后自动连接 ACP，并通过 ACP 管理 Claude Code 会话记录。 */
export function ProjectChatPage(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { getProject, loading } = useProjects()
  const { revision: agentRevision } = useAgentSelection()
  const project = projectId ? getProject(projectId) : undefined
  const routeSessionId = searchParams.get('session') || undefined
  const projectRouteActive = location.pathname.startsWith('/projects/')
  const [retainedSessionTarget, setRetainedSessionTarget] = useState<{ projectId?: string; sessionId?: string }>({
    projectId,
    sessionId: routeSessionId
  })

  // 缓存详情被隐藏后，全局 location 会切到其他一级页面；此时不能改写当前会话目标。
  useLayoutEffect(() => {
    if (projectRouteActive) setRetainedSessionTarget({ projectId, sessionId: routeSessionId })
  }, [location.key, projectId, projectRouteActive, routeSessionId])

  const sessionTarget = projectRouteActive ? { projectId, sessionId: routeSessionId } : retainedSessionTarget

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

  const initialSessionId = sessionTarget.projectId === project.id ? sessionTarget.sessionId : undefined

  return (
    <AgentProvider key={`${project.id}:${initialSessionId ?? 'new'}:${agentRevision}`} cwd={project.path ?? WORKSPACE_PATH} initialSessionId={initialSessionId}>
      <ChatView project={project} />
    </AgentProvider>
  )
}
