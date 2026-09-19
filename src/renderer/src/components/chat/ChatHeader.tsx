import type { ReactElement } from 'react'
import { Button, Space, Tooltip, Typography } from 'antd'
import { PlusOutlined, ProjectOutlined } from '@ant-design/icons'
import type { AgentState } from '@/models'
import { STATUS_DETAILS, STATUS_DOT_COLORS } from '@/utils/constants'
import { GitStatusPanel } from './GitStatusPanel'

interface ChatHeaderProps {
  /** 顶栏标题：项目名或对话标题。 */
  title: string
  state: AgentState
  /** 会话工作目录，用于在右上角展示 Git 环境信息；缺省时不显示该入口。 */
  cwd?: string
  /** 状态异常时点击圆点重新建立连接。 */
  onConnect?: () => void
  /** 点击「新对话」按钮。 */
  onNewConversation: () => void
  /** 是否展示「新对话」按钮；草稿会话本身就是新对话，不需要再开一个。 */
  showNewConversation?: boolean
  /** 切换到该项目的待办看板；仅项目对话提供，仅对话不显示看板入口。 */
  onOpenBoard?: () => void
}

/** 会话区顶栏：左侧连接状态圆点 + 标题 + 「新对话」，右侧图标化的看板入口与 Git 环境信息。
 *  在正式对话页与历史会话加载页共用，确保切换会话时顶部样式保持不变。 */
export function ChatHeader({ title, state, cwd, onConnect, onNewConversation, onOpenBoard, showNewConversation = true }: ChatHeaderProps): ReactElement {
  const status = STATUS_DETAILS[state.status]
  const canRetry = state.status === 'disconnected' || state.status === 'error'

  return (
    <div className="chat-header">
      <div className="chat-header-main">
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
        <Typography.Title level={4} className="chat-project-title" style={{ margin: 0 }}>{title}</Typography.Title>
        {showNewConversation && (
          <Button type="text" className="chat-header-new" icon={<PlusOutlined />} onClick={onNewConversation}>
            新对话
          </Button>
        )}
      </div>
      <Space size={2}>
        {/* 右侧只留图标，文案放进 Tooltip，避免顶栏被文字撑宽。 */}
        {onOpenBoard && (
          <Tooltip title="查看项目看板">
            <Button
              type="text"
              className="chat-header-icon-button"
              icon={<ProjectOutlined />}
              onClick={onOpenBoard}
              aria-label="查看项目看板"
            />
          </Tooltip>
        )}
        {cwd && <GitStatusPanel cwd={cwd} />}
      </Space>
    </div>
  )
}
