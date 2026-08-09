import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { AcpSessionInfo, AgentState, ChatMessage } from '@shared/acp'
import type { ChatAttachment } from '@shared/attachments'
import { acp, assertAcpApi } from '@/services/acp'
import { INITIAL_MESSAGES } from '@/utils/constants'
import { dispatchSessionActivity } from '@/utils/session-events'

const MIN_CONNECTING_MS = 0

interface AgentContextValue {
  /** 当前 ACP 连接状态。 */
  state: AgentState
  /** 当前会话消息列表（assistant 流式消息按 id 合并）。 */
  messages: ChatMessage[]
  /** 当前激活的 ACP 会话 id。 */
  sessionId?: string
  connect: () => Promise<void>
  send: (text: string, attachments?: ChatAttachment[]) => Promise<void>
  stop: () => Promise<void>
  setMode: (modeId: string) => Promise<void>
  setModel: (modelId: string) => Promise<void>
  /** 查询 Claude Code 在该目录下的会话记录（ACP session/list）。 */
  listSessions: () => Promise<AcpSessionInfo[]>
  /** 加载历史会话（ACP session/load），替换当前消息并设为当前会话。 */
  loadSession: (sessionId: string) => Promise<void>
  /** 新建会话（ACP session/new）。 */
  createNewSession: () => Promise<void>
}

const AgentContext = createContext<AgentContextValue | null>(null)

interface AgentProviderProps {
  /** ACP 会话的工作目录，通常是所选项目的路径。 */
  cwd: string
  /** 从工作台等入口直接打开的历史会话。 */
  initialSessionId?: string
  children: ReactNode
}

export function AgentProvider({ cwd, initialSessionId, children }: AgentProviderProps): ReactElement {
  // 进入页面即视为「连接中」，避免首帧先闪现「未连接」
  const [state, setState] = useState<AgentState>({ status: 'connecting', detail: '正在连接 Claude ACP…' })
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [sessionId, setSessionId] = useState<string>()
  const connectingRef = useRef(false)

  const ensureSession = useCallback(async () => {
    assertAcpApi()
    // 默认新建对话，不自动加载上一次的会话
    const created = await acp.createSession(cwd)
    setSessionId(created.sessionId)
    setMessages(INITIAL_MESSAGES)
  }, [cwd])

  const openInitialSession = useCallback(async () => {
    if (!initialSessionId) {
      await ensureSession()
      return
    }

    assertAcpApi()
    const loaded = await acp.loadSession(initialSessionId, cwd)
    setSessionId(loaded.sessionId)
    setMessages(loaded.messages.length > 0 ? loaded.messages : INITIAL_MESSAGES)
  }, [cwd, ensureSession, initialSessionId])

  const connect = useCallback(async () => {
    if (connectingRef.current) return
    connectingRef.current = true
    const startedAt = Date.now()
    try {
      setState({ status: 'connecting', detail: '正在连接 Claude ACP…' })
      assertAcpApi()
      const next = await acp.connect(cwd)
      if (next.status === 'ready') {
        setState({ status: 'connecting', detail: '正在加载历史对话…' })
        await openInitialSession()
        // 让加载动画至少展示 MIN_CONNECTING_MS，连接过程中 ACP 连接仍在进行
        const elapsed = Date.now() - startedAt
        if (elapsed < MIN_CONNECTING_MS) {
          await new Promise((resolve) => setTimeout(resolve, MIN_CONNECTING_MS - elapsed))
        }
        // session/new 会在连接过程中同步权限模式；这里合并状态，避免把 modes 清掉。
        setState((current) => ({ ...current, status: 'ready', detail: 'Claude 已连接' }))
      } else {
        setState(next)
      }
    } catch (error) {
      setState({ status: 'error', detail: error instanceof Error ? error.message : '连接 Claude ACP 失败。' })
    } finally {
      connectingRef.current = false
    }
  }, [cwd, openInitialSession])

  const send = useCallback(async (text: string, attachments: ChatAttachment[] = []) => {
    if (!sessionId) throw new Error('当前会话尚未就绪。')
    const activity = {
      cwd,
      sessionId,
      title: text.replace(/\s+/g, ' ').trim().slice(0, 80) || attachments.map((item) => item.name).join('、').slice(0, 80)
    }
    dispatchSessionActivity({ ...activity, phase: 'started' })
    try {
      await acp.prompt({ text, cwd, attachments })
    } finally {
      dispatchSessionActivity({ ...activity, phase: 'completed' })
    }
  }, [cwd, sessionId])

  const stop = useCallback(async () => {
    await acp.stop()
  }, [])

  const setMode = useCallback(async (modeId: string) => {
    await acp.setMode(modeId)
  }, [])

  const setModel = useCallback(async (modelId: string) => {
    await acp.setModel(modelId)
  }, [])

  const listSessions = useCallback(async () => acp.listSessions(cwd), [cwd])

  const loadSession = useCallback(
    async (id: string) => {
      const loaded = await acp.loadSession(id, cwd)
      setSessionId(loaded.sessionId)
      setMessages(loaded.messages.length > 0 ? loaded.messages : INITIAL_MESSAGES)
    },
    [cwd]
  )

  const createNewSession = useCallback(async () => {
    const created = await acp.createSession(cwd)
    setSessionId(created.sessionId)
    setMessages(INITIAL_MESSAGES)
  }, [cwd])

  useEffect(() => {
    const removeState = acp.onState(setState)
    const removeMessage = acp.onMessage((incoming) => {
      setMessages((current) => {
        // 非 assistant 消息直接追加
        if (incoming.role !== 'assistant') return [...current, incoming]
        // assistant 流式消息按 id 合并内容
        const existing = current.findIndex((item) => item.id === incoming.id)
        if (existing === -1) return [...current, incoming]
        return current.map((item, index) =>
          index === existing
            ? {
                ...item,
                content: item.content + incoming.content,
                attachments: [...(item.attachments ?? []), ...(incoming.attachments ?? [])]
              }
            : item
        )
      })
    })

    // 进入项目后自动连接，无需手动点击
    void connect()

    return () => {
      removeState()
      removeMessage()
    }
  }, [connect])

  const value = useMemo<AgentContextValue>(
    () => ({ state, messages, sessionId, connect, send, stop, setMode, setModel, listSessions, loadSession, createNewSession }),
    [state, messages, sessionId, connect, send, stop, setMode, setModel, listSessions, loadSession, createNewSession]
  )

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
}

export function useAgent(): AgentContextValue {
  const context = useContext(AgentContext)
  if (!context) {
    throw new Error('useAgent 必须在 <AgentProvider> 内使用')
  }
  return context
}
