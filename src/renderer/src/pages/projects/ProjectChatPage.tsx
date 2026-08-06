import type { ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button, Result, Spin } from 'antd'
import { ChatView } from '@/components/chat/ChatView'
import { useProjects } from '@/state/ProjectsContext'
import { AgentProvider } from '@/state/AgentContext'
import { WORKSPACE_PATH } from '@/utils/constants'

/** 项目对话页：进入后自动连接 ACP，并通过 ACP 管理 Claude Code 会话记录。 */
export function ProjectChatPage(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { getProject, loading } = useProjects()
  const project = projectId ? getProject(projectId) : undefined

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

  return (
    <AgentProvider key={project.id} cwd={project.path ?? WORKSPACE_PATH}>
      <ChatView project={project} />
    </AgentProvider>
  )
}
