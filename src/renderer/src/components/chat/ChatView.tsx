import type { ReactElement } from 'react'
import { Alert, Tooltip } from 'antd'
import { useAgent } from '@/state/AgentContext'
import { ChatComposer } from './ChatComposer'
import { ChatHeader } from './ChatHeader'
import { ConnectingScreen } from './ConnectingScreen'
import { SessionLoadingScreen } from './SessionLoadingScreen'
import { ChatEmptyState } from './ChatEmptyState'
import { ChatThread } from './ChatThread'

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

interface ChatViewProps {
  /** 顶栏标题：项目名或对话标题。 */
  title: string
  /** 空会话引导语里的工作区名；仅对话没有可展示的目录名时不传。 */
  workspaceName?: string
  /** 新建会话：项目页换一代 AgentProvider，对话页新建一条仅对话。 */
  onStartNewConversation: () => void
  /** 查看项目看板；仅项目对话提供，仅对话不传。 */
  onOpenBoard?: () => void
  /** 连接/加载态下返回列表的入口；仅对话没有列表页，可不传。 */
  backTo?: string
  backLabel?: string
}

/** 单个协作会话视图：小圆点状态 + 对话线程 + 输入区。 */
export function ChatView({ title, workspaceName, onStartNewConversation, onOpenBoard, backTo, backLabel }: ChatViewProps): ReactElement {
  const { state, cwd, sessionLoading, connect, messages } = useAgent()

  const connecting = state.status === 'disconnected' || state.status === 'connecting'
  // 新会话 / 空历史：不渲染消息列表，改为展示引导语；
  // 生成中或连接异常时保持消息区原样，避免错误提示被引导语顶掉。
  const empty = messages.length === 0 && state.status !== 'working' && state.status !== 'error'

  // 加载历史会话期间整页只展示加载动画，回放完成后再显示聊天界面
  if (sessionLoading) {
    return <SessionLoadingScreen title={title} onStartNewConversation={onStartNewConversation} onOpenBoard={onOpenBoard} />
  }

  // 连接期间整页只展示加载动画，连接完成后再显示聊天界面
  if (connecting) {
    return <ConnectingScreen title={title} backTo={backTo} backLabel={backLabel} />
  }

  return (
    <div className="chat-shell">
      <ChatHeader
        title={title}
        state={state}
        cwd={cwd}
        onConnect={() => void connect()}
        onNewConversation={onStartNewConversation}
        onOpenBoard={onOpenBoard}
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

      {empty ? <ChatEmptyState workspaceName={workspaceName} /> : <ChatThread />}
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
