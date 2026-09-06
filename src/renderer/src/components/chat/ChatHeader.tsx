import type { ReactElement } from 'react'
import { Button, Space, Tooltip, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import type { AgentState, Project } from '@/models'
import { STATUS_DETAILS, STATUS_DOT_COLORS } from '@/utils/constants'

interface ChatHeaderProps {
  project: Project
  state: AgentState
  /** 状态异常时点击圆点重新建立连接。 */
  onConnect?: () => void
  /** 点击「新对话」按钮。 */
  onNewConversation: () => void
}

/** 会话区顶栏：连接状态圆点 + 项目标题 + 「新对话」按钮。
 *  在正式对话页与历史会话加载页共用，确保切换会话时顶部样式保持不变。 */
export function ChatHeader({ project, state, onConnect, onNewConversation }: ChatHeaderProps): ReactElement {
  const status = STATUS_DETAILS[state.status]
  const canRetry = state.status === 'disconnected' || state.status === 'error'

  return (
    <div className="chat-header">
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Tooltip title={canRetry ? `点击重新连接（${status.label}）` : status.label}>
            <span
              className="chat-status"
              onClick={canRetry ? onConnect : undefined}
              role={canRetry ? 'button' : undefined}
              tabIndex={canRetry ? 0 : undefined}
              onKeyDown={(event) => {
                if (canRetry && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  onConnect?.()
                }
              }}
            >
              <span className="chat-status-dot" style={{ background: STATUS_DOT_COLORS[state.status] }} />
            </span>
          </Tooltip>
          <Typography.Title level={4} className="chat-project-title" style={{ margin: 0 }}>{project.name}</Typography.Title>
        </div>
      </div>
      <Space size={2}>
        <Button type="text" icon={<PlusOutlined />} onClick={onNewConversation}>
          新对话
        </Button>
      </Space>
    </div>
  )
}
