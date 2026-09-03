import type { AgentStatus, ChatMessage, StatusMeta } from '@/models'

export const INITIAL_MESSAGES: ChatMessage[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: '你好，我是 Koala。连接后，我可以在当前项目中协助你阅读、规划和实现代码。',
    createdAt: new Date().toISOString()
  }
]

/** 连接状态对应的圆点颜色（UI 小状态指示）。 */
export const STATUS_DOT_COLORS: Record<AgentStatus, string> = {
  disconnected: 'var(--muted-soft)',
  connecting: 'var(--warning)',
  ready: 'var(--success)',
  working: 'var(--primary)',
  error: 'var(--error)'
}

export const STATUS_DETAILS: Record<AgentStatus, StatusMeta> = {
  disconnected: { badge: 'default', label: '未连接' },
  connecting: { badge: 'processing', label: '连接中' },
  ready: { badge: 'success', label: '已就绪' },
  working: { badge: 'processing', label: '正在生成' },
  error: { badge: 'error', label: '连接异常' }
}
