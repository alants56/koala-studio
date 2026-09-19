import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type { Conversation, UpdateConversationInput } from '@shared/conversations'
import { conversationsApi } from '@/services/conversations'

interface ConversationsContextValue {
  /** 按最近使用倒序排列的仅对话列表。 */
  conversations: Conversation[]
  loading: boolean
  refresh: () => Promise<void>
  createConversation: () => Promise<Conversation>
  updateConversation: (id: string, input: UpdateConversationInput) => Promise<Conversation>
  /** 刷新最近使用时间，让正在使用的对话排到最前。 */
  touchConversation: (id: string) => Promise<void>
  /** 归档 / 取消归档对话（只改变索引标记，可在「已归档」分组里恢复）。 */
  setConversationArchived: (id: string, archived: boolean) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  getConversation: (id: string) => Conversation | undefined
}

const ConversationsContext = createContext<ConversationsContextValue | null>(null)

/** 与主进程 list() 保持一致：按最近使用倒序。 */
function sortByRecency(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export function ConversationsProvider({ children }: { children: ReactNode }): ReactElement {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await conversationsApi.list()
        if (!cancelled) setConversations(sortByRecency(list))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    setConversations(sortByRecency(await conversationsApi.list()))
  }, [])

  const createConversation = useCallback(async () => {
    const created = await conversationsApi.create()
    setConversations((current) => sortByRecency([created, ...current]))
    return created
  }, [])

  const updateConversation = useCallback(async (id: string, input: UpdateConversationInput) => {
    const updated = await conversationsApi.update(id, input)
    setConversations((current) => sortByRecency(current.map((conversation) => (conversation.id === id ? updated : conversation))))
    return updated
  }, [])

  const touchConversation = useCallback(async (id: string) => {
    const updated = await conversationsApi.touch(id)
    setConversations((current) => sortByRecency(current.map((conversation) => (conversation.id === id ? updated : conversation))))
  }, [])

  const deleteConversation = useCallback(async (id: string) => {
    await conversationsApi.delete(id)
    setConversations((current) => current.filter((conversation) => conversation.id !== id))
  }, [])

  const setConversationArchived = useCallback(async (id: string, archived: boolean) => {
    const updated = await conversationsApi.setArchived(id, archived)
    setConversations((current) => sortByRecency(current.map((conversation) => (conversation.id === id ? updated : conversation))))
  }, [])

  const getConversation = useCallback(
    (id: string) => conversations.find((conversation) => conversation.id === id),
    [conversations]
  )

  const value = useMemo(
    () => ({ conversations, loading, refresh, createConversation, updateConversation, touchConversation, setConversationArchived, deleteConversation, getConversation }),
    [conversations, loading, refresh, createConversation, updateConversation, touchConversation, setConversationArchived, deleteConversation, getConversation]
  )

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>
}

export function useConversations(): ConversationsContextValue {
  const context = useContext(ConversationsContext)
  if (!context) {
    throw new Error('useConversations 必须在 <ConversationsProvider> 内使用')
  }
  return context
}
