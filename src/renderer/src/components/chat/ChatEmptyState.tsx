import type { ReactElement } from 'react'

interface ChatEmptyStateProps {
  /** 工作区 / 项目名，会以虚线标出；仅对话没有可展示的目录名时省略。 */
  workspaceName?: string
}

/** 新会话或加载到空历史时的引导语：宋体提问。 */
export function ChatEmptyState({ workspaceName }: ChatEmptyStateProps): ReactElement {
  return (
    <div className="chat-empty-state">
      <p className="chat-empty-state-title">
        {workspaceName
          ? <><span className="chat-empty-state-name">{workspaceName}</span>，我能为你做些什么？</>
          : '我能为你做些什么？'}
      </p>
    </div>
  )
}
