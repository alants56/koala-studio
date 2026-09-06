import type { ReactElement } from 'react'
import { Alert, App, Tooltip } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Project } from '@/models'
import { useAgent } from '@/state/AgentContext'
import { ChatComposer } from './ChatComposer'
import { ChatHeader } from './ChatHeader'
import { ConnectingScreen } from './ConnectingScreen'
import { SessionLoadingScreen } from './SessionLoadingScreen'
import { ChatThread } from './ChatThread'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** 单个项目的协作会话视图：小圆点状态 + 对话线程 + 输入区。 */
export function ChatView({ project }: { project: Project }): ReactElement {
  const { state, sessionLoading, connect, createNewSession } = useAgent()
  const { message } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()

  const connecting = state.status === 'disconnected' || state.status === 'connecting'

  const handleNewConversation = async (): Promise<void> => {
    const projectPath = `/projects/${encodeURIComponent(project.id)}`

    // 历史会话详情回到项目页会由路由创建新会话；项目页本身则需直接重置会话。
    if (new URLSearchParams(location.search).has('session')) {
      void navigate(projectPath)
      return
    }

    try {
      await createNewSession()
      void navigate(projectPath, { replace: true })
    } catch (error) {
      message.error(error instanceof Error ? error.message : '新建对话失败')
    }
  }

  // 加载历史会话期间整页只展示加载动画，回放完成后再显示聊天界面
  if (sessionLoading) {
    return <SessionLoadingScreen project={project} />
  }

  // 连接期间整页只展示加载动画，连接完成后再显示聊天界面
  if (connecting) {
    return <ConnectingScreen project={project} />
  }

  return (
    <div className="chat-shell">
      <ChatHeader
        project={project}
        state={state}
        onConnect={() => void connect()}
        onNewConversation={() => void handleNewConversation()}
      />

      {state.status === 'error' && (
        <Alert
          type="error"
          showIcon
          style={{ margin: '16px 0' }}
          message="ACP 连接失败"
          description={state.detail ?? '无法启动 Claude ACP 服务。'}
        />
      )}

      <ChatThread />
      <ChatComposer />
      {state.usage && (
        <Tooltip title={`上下文：${state.usage.used.toLocaleString()} / ${state.usage.size.toLocaleString()} tokens`}>
          <span className="chat-token-usage">
            {formatTokens(state.usage.used)} / {formatTokens(state.usage.size)}
          </span>
        </Tooltip>
      )}
    </div>
  )
}
