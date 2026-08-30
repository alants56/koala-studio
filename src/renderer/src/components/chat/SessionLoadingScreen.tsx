import type { ReactElement } from 'react'
import { Spin, Typography } from 'antd'
import type { Project } from '@/models'
import { useAgent } from '@/state/AgentContext'

/** 加载历史会话时的整页加载动画：在 ACP 读取并回放历史消息期间展示。 */
export function SessionLoadingScreen({ project }: { project: Project }): ReactElement {
  const { state } = useAgent()
  const agentName = state.currentAgent === 'pi' ? 'Pi' : 'Claude'

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 py-16" role="status" aria-live="polite">
      <div className="relative grid h-24 w-24 place-items-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-blue-100/70" aria-hidden="true" />
        <Spin size="large" />
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <Typography.Title level={5} style={{ margin: 0 }}>
          正在加载「{project.name}」的历史会话…
        </Typography.Title>
        <Typography.Text type="secondary">正在读取并回放历史对话（{agentName}），请稍候…</Typography.Text>
      </div>
    </div>
  )
}
