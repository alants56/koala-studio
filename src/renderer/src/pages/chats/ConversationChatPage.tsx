import { useCallback, useEffect, useRef, type ReactElement } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { App, Button, Result, Spin } from 'antd'
import { DEFAULT_CONVERSATION_TITLE, type UpdateConversationInput } from '@shared/conversations'
import type { ChatAttachment } from '@shared/attachments'
import { ChatView } from '@/components/chat/ChatView'
import { AgentProvider, DraftAgentProvider, useAgent } from '@/state/AgentContext'
import { useAgentSelection } from '@/state/AgentSelectionContext'
import { useConversations } from '@/state/ConversationsContext'
import { subscribeSessionActivity } from '@/utils/session-events'
import { readableIpcError } from '@/utils/ipc-error'

/** 草稿页提交后带到对话页的首条消息。 */
interface PendingPrompt {
  text: string
  attachments?: ChatAttachment[]
}

/**
 * 发送从草稿页带过来的首条消息：会话建立（新建 / 加载完成）后自动发出一次。
 * 发送失败时保留待发内容，连接恢复（state.status 变化）后会自动重试。
 */
function PendingPromptSender({ prompt, onSent }: { prompt?: PendingPrompt; onSent: () => void }): null {
  const { message } = App.useApp()
  const { state, messages, send } = useAgent()
  const sentRef = useRef(false)

  useEffect(() => {
    if (!prompt || sentRef.current) return
    // 会话就绪且还没有消息：此时发送不会落在历史回放中间；加载已有会话时 messages 非空，不会重复发。
    if (state.status !== 'ready' || messages.length > 0) return
    sentRef.current = true
    void send(prompt.text, prompt.attachments ?? [])
      .then(onSent)
      .catch((error: unknown) => {
        sentRef.current = false
        void message.error(error instanceof Error ? error.message : '发送消息失败。')
      })
  }, [message, messages.length, onSent, prompt, send, state.status])

  return null
}

/**
 * 仅对话页：一条对话 = 一个自动创建的时间戳目录 + 其中的一个 ACP 会话。
 *
 * 目录路径不展示给用户，界面只呈现对话历史（侧栏列表与顶栏标题）。
 * `/chats/new` 是草稿页：只有输入框，不建目录也不开会话；提交首条消息时才创建对话，
 * 随后调到正式对话页并把这条消息发出去。
 */
export function ConversationChatPage(): ReactElement {
  const { conversationId } = useParams<{ conversationId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { getConversation, loading, createConversation, updateConversation, touchConversation } = useConversations()
  const { revision: agentRevision, currentAgent } = useAgentSelection()
  const conversation = conversationId ? getConversation(conversationId) : undefined
  const pendingPrompt = (location.state as { pendingPrompt?: PendingPrompt } | null)?.pendingPrompt

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

  /** 草稿入口：不落盘、不建会话；已经在草稿页时替换当前记录，避免堆叠历史。 */
  const openDraft = useCallback((): void => {
    void navigate('/chats/new', { replace: location.pathname === '/chats/new' })
  }, [location.pathname, navigate])

  /** 草稿页提交：此时才在主进程创建时间戳目录与索引，然后跳到正式对话页。 */
  const submitDraft = useCallback(async (text: string, attachments: ChatAttachment[] = []): Promise<void> => {
    try {
      const created = await createConversation()
      void navigate(`/chats/${encodeURIComponent(created.id)}`, { state: { pendingPrompt: { text, attachments } } })
    } catch (error) {
      throw new Error(readableIpcError(error, '新建对话失败'))
    }
  }, [createConversation, navigate])

  /** 首条消息发出去后清掉路由 state，刷新页面不会重发。 */
  const clearPendingPrompt = useCallback((): void => {
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
  }, [location.pathname, location.search, navigate])

  // 草稿对话：只有输入框，没有目录、索引与 ACP 会话。
  if (!conversationId) {
    return (
      <DraftAgentProvider onSubmit={submitDraft}>
        <ChatView title={DEFAULT_CONVERSATION_TITLE} onStartNewConversation={openDraft} />
      </DraftAgentProvider>
    )
  }

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
        extra={<Button type="primary" onClick={openDraft}>新建对话</Button>}
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
      <PendingPromptSender prompt={pendingPrompt} onSent={clearPendingPrompt} />
      <ChatView title={conversation.title} onStartNewConversation={openDraft} />
    </AgentProvider>
  )
}
