import type { ChatMessage } from './acp'

/** 整条消息由一个或多个 harness 信封块构成时才匹配。
 * Claude Code 把后台任务通知、system-reminder、本地命令回显都以 user 角色写进会话记录，
 * 但这些都不是用户输入。要求「整条都是信封」而非「以信封开头」，
 * 这样开头恰好是这类标签的真实提问不会被误删。 */
const HARNESS_ENVELOPE_RE =
  /^\s*(?:<(task-notification|system-reminder|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>[\s\S]*?<\/\1>\s*)+$/

/** 判断一条 user 角色的消息其实是 Claude Code 注入的 harness 信封，不是用户输入。
 * 上游实时流式时会跳过它们，回放 session/load 时却会原样转发，需要在桥接层拦掉。 */
export function isHarnessEnvelope(content: string): boolean {
  return HARNESS_ENVELOPE_RE.test(content)
}

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
