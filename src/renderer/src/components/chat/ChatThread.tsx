import { useEffect, useRef, type ReactElement } from 'react'
import { useAgent } from '@/state/AgentContext'
import { ChatMessageItem } from './ChatMessageItem'

/** 对话消息列表：消息变化时自动滚动到底部。 */
export function ChatThread(): ReactElement {
  const { messages, state } = useAgent()
  const scrollRef = useRef<HTMLElement>(null)
  const latestMessageId = messages[messages.length - 1]?.id

  useEffect(() => {
    const box = scrollRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [messages])

  return (
    <section
      ref={scrollRef}
      className="chat-thread flex flex-1 flex-col gap-4 overflow-y-auto"
      aria-label="Koala 对话"
    >
      {messages.map((message) => (
        <ChatMessageItem
          key={message.id}
          message={message}
          streaming={state.status === 'working' && message.role === 'assistant' && message.id === latestMessageId}
        />
      ))}
    </section>
  )
}
