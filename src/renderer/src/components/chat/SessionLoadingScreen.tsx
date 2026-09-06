import type { ReactElement } from 'react'
import { Skeleton, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import type { Project } from '@/models'
import { useAgent } from '@/state/AgentContext'
import { ChatHeader } from './ChatHeader'

/**
 * 加载历史会话时的整页加载动画：在 ACP 读取并回放历史消息期间展示。
 * 复用与正式对话一致的 chat-shell 布局（页头 + 消息区 + 输入区），
 * 用骨架屏模拟真实的消息结构，让加载态与正式会话无缝衔接。
 */
export function SessionLoadingScreen({ project }: { project: Project }): ReactElement {
  const { state } = useAgent()
  const navigate = useNavigate()
  const agentName = state.currentAgent === 'pi' ? 'Pi' : 'Claude'

  const handleNewConversation = (): void => {
    // 历史会话详情回到项目页将创建新会话，加载动画随之被替换。
    void navigate(`/projects/${encodeURIComponent(project.id)}`)
  }

  return (
    <div className="chat-shell chat-loading-screen" role="status" aria-live="polite">
      <ChatHeader project={project} state={state} onNewConversation={handleNewConversation} />

      <div className="chat-thread chat-loading-thread flex flex-1 flex-col overflow-y-auto">
        {/* 助手正文骨架 */}
        <div className="chat-loading-message chat-loading-message--assistant">
          <div className="chat-loading-avatar" aria-hidden="true">
            <Spin size="small" />
          </div>
          <Skeleton
            active
            title={false}
            paragraph={{ rows: 2, width: ['92%', '58%'] }}
            className="chat-loading-skeleton"
          />
        </div>

        {/* 用户气泡骨架 */}
        <div className="chat-loading-message chat-loading-message--user">
          <div className="chat-loading-user-bubble" aria-hidden="true" />
        </div>

        {/* 思考 / 工具调用骨架 */}
        <div className="chat-loading-activity" aria-hidden="true" />

        {/* 助手正文骨架（第二轮） */}
        <div className="chat-loading-message chat-loading-message--assistant">
          <div className="chat-loading-avatar" aria-hidden="true">
            <Spin size="small" />
          </div>
          <Skeleton
            active
            title={false}
            paragraph={{ rows: 3, width: ['90%', '76%', '42%'] }}
            className="chat-loading-skeleton"
          />
        </div>
      </div>

      <div className="chat-composer-wrap">
        <div className="chat-loading-composer" aria-hidden="true" />
        <div className="chat-loading-note">
          正在读取并回放历史对话（{agentName}），请稍候…
        </div>
      </div>
    </div>
  )
}
