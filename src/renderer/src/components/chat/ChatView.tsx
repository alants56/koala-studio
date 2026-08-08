import { useState, type ReactElement } from 'react'
import { Alert, App, Button, Drawer, Empty, Skeleton, Space, Tooltip, Typography } from 'antd'
import { Conversations } from '@ant-design/x'
import { HistoryOutlined, MessageOutlined, PlusOutlined } from '@ant-design/icons'
import type { AcpSessionInfo, Project } from '@/models'
import { useAgent } from '@/state/AgentContext'
import { STATUS_DETAILS, STATUS_DOT_COLORS } from '@/utils/constants'
import { formatDateTime } from '@/utils/format'
import { ChatComposer } from './ChatComposer'
import { ConnectingScreen } from './ConnectingScreen'
import { ChatThread } from './ChatThread'

/** 单个项目的协作会话视图：小圆点状态 + 历史对话抽屉（来自 ACP）+ 对话线程 + 输入区。 */
export function ChatView({ project }: { project: Project }): ReactElement {
  const { state, sessionId, connect, listSessions, loadSession, createNewSession } = useAgent()
  const { message } = App.useApp()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [sessions, setSessions] = useState<AcpSessionInfo[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)

  const status = STATUS_DETAILS[state.status]
  const canRetry = state.status === 'disconnected' || state.status === 'error'
  const connecting = state.status === 'disconnected' || state.status === 'connecting'

  const openDrawer = async (): Promise<void> => {
    setDrawerOpen(true)
    setSessionsLoading(true)
    try {
      setSessions(await listSessions())
    } catch (error) {
      setSessions([])
      message.error(error instanceof Error ? error.message : '获取历史对话失败')
    } finally {
      setSessionsLoading(false)
    }
  }

  const handleSwitch = async (id: string): Promise<void> => {
    try {
      await loadSession(id)
      setDrawerOpen(false)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载该会话失败')
    }
  }

  const handleNew = async (): Promise<void> => {
    try {
      await createNewSession()
      setDrawerOpen(false)
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
          <Tooltip title="新建对话">
            <Button type="text" size="small" icon={<PlusOutlined />} onClick={() => void handleNew()} aria-label="新建对话" />
          </Tooltip>
          <Tooltip title="历史对话">
            <Button type="text" size="small" icon={<HistoryOutlined />} onClick={() => void openDrawer()} aria-label="历史对话" />
          </Tooltip>
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

      <Drawer
        className="chat-history-drawer"
        title={
          <div className="chat-history-drawer-title">
            <span>历史对话</span>
            {sessions.length > 0 && <span className="chat-history-count">{sessions.length}</span>}
          </div>
        }
        placement="right"
        width={372}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        {sessionsLoading ? (
          <Skeleton className="chat-history-skeleton" active paragraph={{ rows: 6 }} />
        ) : sessions.length === 0 ? (
          <Empty className="chat-history-empty" description="暂无 Claude Code 对话记录" />
        ) : (
          <Conversations
            aria-label="历史对话列表"
            className="chat-history-list"
            items={sessions.map((session) => ({
              key: session.sessionId,
              icon: <MessageOutlined />,
              label: (
                <span className="chat-history-session">
                  <span className="chat-history-session-heading">
                    <span className="chat-history-session-title" title={session.title || '未命名对话'}>
                      {session.title || '未命名对话'}
                    </span>
                    {sessionId === session.sessionId && <span className="chat-history-session-current">当前</span>}
                  </span>
                  {session.updatedAt && <span className="chat-history-session-time">更新于 {formatDateTime(session.updatedAt)}</span>}
                </span>
              )
            }))}
            activeKey={sessionId}
            onActiveChange={(key) => void handleSwitch(key)}
          />
        )}
      </Drawer>
    </div>
  )
}
