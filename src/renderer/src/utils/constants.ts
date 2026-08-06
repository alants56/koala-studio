import type { AgentStatus, ChatMessage, StatusMeta } from '@/models'

/** ACP 会话工作目录。后续可由主进程注入，先作为常量放在这里。 */
export const WORKSPACE_PATH = '/Users/liuao/work/Agent/koala-studio'

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
  disconnected: '#d9d9d9',
  connecting: '#faad14',
  ready: '#52c41a',
  working: '#1677ff',
  error: '#ff4d4f'
}

export const STATUS_DETAILS: Record<AgentStatus, StatusMeta> = {
  disconnected: { badge: 'default', label: '未连接' },
  connecting: { badge: 'processing', label: '连接中' },
  ready: { badge: 'success', label: '已就绪' },
  working: { badge: 'processing', label: '正在生成' },
  error: { badge: 'error', label: '连接异常' }
}
