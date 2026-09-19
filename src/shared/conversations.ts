import type { AgentAdapterId } from './acp'

/** 未产生首条消息前的默认对话标题。 */
export const DEFAULT_CONVERSATION_TITLE = '新对话'

/**
 * 仅对话（轻量级项目）：没有用户指定的项目路径。
 *
 * 每条对话独占一个「应用数据目录 / conversations / <年月日时分秒>」目录，
 * 作为该对话的 ACP 工作目录——会话记录与 Agent 产物都落在里面。
 * 目录路径不对用户展示，界面只展示对话历史。
 */
export interface Conversation {
  id: string
  /** 界面展示的标题；默认「新对话」，首条消息发出后由消息内容更新。 */
  title: string
  /** 对话专属工作目录（绝对路径，不对用户展示）。 */
  dir: string
  /** 该对话的 ACP 会话 id；连接建立后写回，重开时用它加载历史。 */
  sessionId?: string
  /** 会话 id 所属的 Agent；切换 Agent 后需要在该目录内新开一个会话。 */
  agent?: AgentAdapterId
  /** 归档时间；存在时侧栏默认收起该对话，可在「已归档」分组里取消归档。 */
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface UpdateConversationInput {
  title?: string
  sessionId?: string
  agent?: AgentAdapterId
}

export interface ConversationsApi {
  /** 按最近使用倒序返回全部仅对话。 */
  list: () => Promise<Conversation[]>
  /** 新建一条对话：创建时间戳目录并写入索引，返回新对话。 */
  create: () => Promise<Conversation>
  update: (id: string, input: UpdateConversationInput) => Promise<Conversation>
  /** 只刷新最近使用时间，用于把正在使用的对话排到最前。 */
  touch: (id: string) => Promise<Conversation>
  /** 归档 / 取消归档对话；只改变索引标记，不删除目录与产物。 */
  setArchived: (id: string, archived: boolean) => Promise<Conversation>
  /** 删除对话索引；对话目录与其中的产物保留在本地。 */
  delete: (id: string) => Promise<void>
}
