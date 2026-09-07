import type { ChatMessage } from './acp'

/** ACP text events are deltas; tool events are complete snapshots. */
export function mergeChatMessage(messages: ChatMessage[], incoming: ChatMessage): ChatMessage[] {
  const existing = messages.findIndex((message) => message.id === incoming.id)
  if (existing < 0) return [...messages, incoming]
  return messages.map((message, index) => {
    if (index !== existing) return message
    if (incoming.kind === 'tool' || incoming.role === 'system') return incoming
    return {
      ...message,
      content: message.content + incoming.content,
      attachments: [...(message.attachments ?? []), ...(incoming.attachments ?? [])],
      finishedAt: incoming.finishedAt ?? message.finishedAt
    }
  })
}
