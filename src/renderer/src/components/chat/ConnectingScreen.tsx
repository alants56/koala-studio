import type { ReactElement } from 'react'
import { Button, Spin, Typography } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { Project } from '@/models'
import { useAgent } from '@/state/AgentContext'

/** 进入项目对话页时的连接加载动画：在建立 ACP 连接期间整页展示。 */
export function ConnectingScreen({ project }: { project: Project }): ReactElement {
  const { state } = useAgent()
  const navigate = useNavigate()

  return (
    <div className="chat-loading-screen flex h-full flex-col items-center justify-center gap-6 py-16" role="status" aria-live="polite">
      <div className="relative grid h-24 w-24 place-items-center">
        <span className="chat-loading-ping absolute inset-0 animate-ping rounded-full" aria-hidden="true" />
        <Spin size="large" />
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <Typography.Title level={5} style={{ margin: 0 }}>
          正在连接「{project.name}」…
        </Typography.Title>
        <Typography.Text type="secondary">{state.detail ?? '正在建立 Claude ACP 连接…'}</Typography.Text>
      </div>
      <Button type="text" size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate('/projects')}>
        返回项目列表
      </Button>
    </div>
  )
}
