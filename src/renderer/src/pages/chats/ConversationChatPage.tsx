import { useCallback, useEffect, type ReactElement } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { App, Button, Result, Spin } from 'antd'
import { DEFAULT_CONVERSATION_TITLE, type UpdateConversationInput } from '@shared/conversations'
import { ChatView } from '@/components/chat/ChatView'
import { AgentProvider } from '@/state/AgentContext'
import { useAgentSelection } from '@/state/AgentSelectionContext'
import { useConversations } from '@/state/ConversationsContext'
import { subscribeSessionActivity } from '@/utils/session-events'
import { readableIpcError } from '@/utils/ipc-error'

/**
 * 仅对话页：一条对话 = 一个自动创建的时间戳目录 + 其中的一个 ACP 会话。
 *
 * 目录路径不展示给用户，界面只呈现对话历史（侧栏列表与顶栏标题）。
 * 「新对话」不在同一目录里另开会话，而是新建一条对话（新目录），
 * 这样侧栏每一条记录都对应一个可重开的会话，不会残留被隐藏的孤儿会话。
 */
export function ConversationChatPage(): ReactElement {
  const { conversationId } = useParams<{ conversationId: string }>()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const { getConversation, loading, createConversation, updateConversation, touchConversation } = useConversations()
  const { revision: agentRevision, currentAgent } = useAgentSelection()
  const conversation = conversationId ? getConversation(conversationId) : undefined

  const handleSessionReady = useCallback((sessionId: string): void => {
    // 打开已有会话时 id 不变，不产生多余写入；新建会话时把 id 与 Agent 一并记上。
    if (!conversation || (conversation.sessionId === sessionId && conversation.agent === currentAgent)) return
    void updateConversation(conversation.id, { sessionId, agent: currentAgent }).catch(() => undefined)
  }, [conversation, currentAgent, updateConversation])

  const handleFirstPrompt = useCallback((sessionId: string, title: string): void => {
    if (!conversation) return
    const input: UpdateConversationInput = { sessionId, agent: currentAgent }
    // 标题只在还是默认值时取首条消息；重开后继续对话不会把标题改成「继续」之类的消息。
    if (conversation.title === DEFAULT_CONVERSATION_TITLE) input.title = title
    void updateConversation(conversation.id, input).catch(() => undefined)
  }, [conversation, currentAgent, updateConversation])

  /** 每轮提问都刷新最近使用时间，让侧栏把正在用的对话排到最前。 */
  const conversationDir = conversation?.dir
  useEffect(() => {
    if (!conversationDir || !conversationId) return
    return subscribeSessionActivity((activity) => {
      if (activity.cwd !== conversationDir) return
      void touchConversation(conversationId).catch(() => undefined)
    })
  }, [conversationDir, conversationId, touchConversation])

  const startNewConversation = useCallback((): void => {
    void (async () => {
      try {
        const created = await createConversation()
        void navigate(`/chats/${encodeURIComponent(created.id)}`)
      } catch (error) {
        void message.error(readableIpcError(error, '新建对话失败'))
      }
    })()
  }, [createConversation, message, navigate])

  // 对话索引尚未从主进程读取完成时，不能把临时的空列表误判为对话不存在。
  if (loading) {
    return (
      <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
        <Spin size="large" />
      </div>
    )
  }

  if (!conversation) {
    return (
      <Result
        status="404"
        title="对话不存在"
        subTitle="未找到该对话，可能已被删除。"
        extra={<Button type="primary" onClick={startNewConversation}>新建对话</Button>}
      />
    )
  }

  return (
    <AgentProvider
      key={`${conversation.id}:${agentRevision}`}
      cwd={conversation.dir}
      // 会话 id 属于某个 Agent；切换 Agent 后加载会失败，改为在同一目录内新开会话。
      initialSessionId={conversation.agent && conversation.agent !== currentAgent ? undefined : conversation.sessionId}
      onSessionReady={handleSessionReady}
      onFirstPrompt={handleFirstPrompt}
    >
      <ChatView title={conversation.title} onStartNewConversation={startNewConversation} />
    </AgentProvider>
  )
}
