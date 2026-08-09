import type { ReactElement } from 'react'
import { Alert, App, Button, Space, Tooltip, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Project } from '@/models'
import { useAgent } from '@/state/AgentContext'
import { STATUS_DETAILS, STATUS_DOT_COLORS } from '@/utils/constants'
import { ChatComposer } from './ChatComposer'
import { ConnectingScreen } from './ConnectingScreen'
import { ChatThread } from './ChatThread'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/** 单个项目的协作会话视图：小圆点状态 + 对话线程 + 输入区。 */
export function ChatView({ project }: { project: Project }): ReactElement {
  const { state, messages, connect, createNewSession } = useAgent()
  const { message } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()

  const status = STATUS_DETAILS[state.status]
  const canRetry = state.status === 'disconnected' || state.status === 'error'
  const connecting = state.status === 'disconnected' || state.status === 'connecting'
  const hasConversationContent = messages.some((item) => item.role === 'user')

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

  // 连接期间整页只展示加载动画，连接完成后再显示聊天界面
  if (connecting) {
    return <ConnectingScreen project={project} />
  }

  return (
    <div className="chat-shell">
      <div className="chat-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tooltip title={canRetry ? `点击重新连接（${status.label}）` : status.label}>
              <span
                className="chat-status"
                onClick={canRetry ? () => void connect() : undefined}
                role={canRetry ? 'button' : undefined}
                tabIndex={canRetry ? 0 : undefined}
                onKeyDown={(event) => {
                  if (canRetry && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    void connect()
                  }
                }}
              >
                <span className="chat-status-dot" style={{ background: STATUS_DOT_COLORS[state.status] }} />
                {status.label}
              </span>
            </Tooltip>
            <Typography.Title level={4} className="chat-project-title" style={{ margin: 0 }}>{project.name}</Typography.Title>
          </div>
          {project.path && <Typography.Text className="chat-project-path">{project.path}</Typography.Text>}
        </div>
        <Space size={2}>
          {hasConversationContent && (
            <Button type="text" icon={<PlusOutlined />} onClick={() => void handleNewConversation()}>
              新对话
            </Button>
          )}
        </Space>
      </div>

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
