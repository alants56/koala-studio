import type { ReactElement } from 'react'
import { Alert, Tooltip } from 'antd'
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

interface ChatViewProps {
  project: Project
  /** 新建会话：由项目页换一代 AgentProvider，重挂载时的连接会建出恰好一个会话。 */
  onStartNewConversation: () => void
}

/** 单个项目的协作会话视图：小圆点状态 + 对话线程 + 输入区。 */
export function ChatView({ project, onStartNewConversation }: ChatViewProps): ReactElement {
  const { state, cwd, sessionLoading, connect } = useAgent()
  const location = useLocation()
  const navigate = useNavigate()

  const connecting = state.status === 'disconnected' || state.status === 'connecting'

  /** 只替换 view，保留 session：从看板回来还停在同一个会话上，且不会触发 AgentProvider 重挂载。 */
  const handleOpenBoard = (): void => {
    const params = new URLSearchParams(location.search)
    params.set('view', 'board')
    void navigate({ pathname: location.pathname, search: params.toString() })
  }

  // 加载历史会话期间整页只展示加载动画，回放完成后再显示聊天界面
  if (sessionLoading) {
    return <SessionLoadingScreen project={project} onStartNewConversation={onStartNewConversation} />
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
        cwd={cwd}
        onConnect={() => void connect()}
        onNewConversation={onStartNewConversation}
        onOpenBoard={handleOpenBoard}
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
