import type { ConversationsApi } from '@shared/conversations'

/** 渲染进程访问仅对话存储的唯一入口（由 preload 注入）。 */
export const conversationsApi: ConversationsApi = window.conversations
