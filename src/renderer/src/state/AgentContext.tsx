import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { agentDisplayName, type AcpSessionInfo, type AgentState, type ChatMessage, type SessionTarget } from '@shared/acp'
import type { ChatAttachment } from '@shared/attachments'
import { acp, assertAcpApi } from '@/services/acp'
import { useAgentSelection } from '@/state/AgentSelectionContext'
import { INITIAL_MESSAGES } from '@/utils/constants'
import { applySessionEvent, restoreSessionView, type SessionEvent, type SessionView } from '@shared/session-stream'
import { dispatchSessionActivity } from '@/utils/session-events'


interface AgentContextValue {
  /** 当前 ACP 连接状态。 */
  state: AgentState
  /** ACP 会话工作目录（用于解析对话中引用的文件路径）。 */
  cwd: string
  /** 当前会话消息列表（assistant 流式消息按 id 合并）。 */
  messages: ChatMessage[]
  /** 正在加载历史会话（ACP session/load 回放中），页面应展示加载动画。 */
  sessionLoading: boolean
  /** 当前激活的 ACP 会话 id。 */
  sessionId?: string
  connect: () => Promise<void>
  send: (text: string, attachments?: ChatAttachment[]) => Promise<void>
  removeQueuedPrompt: (id: string) => Promise<void>
  steerQueuedPrompt: (id: string) => Promise<void>
  stop: () => Promise<void>
  setMode: (modeId: string) => Promise<void>
  setModel: (modelId: string) => Promise<void>
  setEffort: (effortId: string) => Promise<void>
  /** 回复当前待确认的权限请求。 */
  respondPermission: (optionId: string) => Promise<void>
  /** 查询 Agent 在该目录下的会话记录（ACP session/list）。 */
  listSessions: () => Promise<AcpSessionInfo[]>
  /** 加载历史会话（ACP session/load），替换当前消息并设为当前会话。 */
  loadSession: (sessionId: string) => Promise<void>
}

const AgentContext = createContext<AgentContextValue | null>(null)

interface AgentProviderProps {
  /** ACP 会话的工作目录，通常是所选项目的路径。 */
  cwd: string
  /** 从工作台等入口直接打开的历史会话。 */
  initialSessionId?: string
  /**
   * 每个会话的首条用户消息成功发出后触发一次。
   * 用于把「从待办跳进来」这类外部意图绑定到实际产生的会话上——只有真的开始对话才会绑定。
   */
  onFirstPrompt?: (sessionId: string, title: string) => void
  /**
   * 会话建立（新建或加载成功）后触发一次。
   * 仅对话用它把 sessionId 写回索引，重开时才能加载到同一个会话而不是新建一个。
   */
  onSessionReady?: (sessionId: string) => void
  children: ReactNode
}

export function AgentProvider({ cwd, initialSessionId, onFirstPrompt, onSessionReady, children }: AgentProviderProps): ReactElement {
  const { currentAgent } = useAgentSelection()
  const agentName = agentDisplayName(currentAgent)
  // 进入页面即视为「连接中」，避免首帧先闪现「未连接」
  const [state, setState] = useState<AgentState>({ status: 'connecting', detail: `正在连接 ${agentName} ACP…`, currentAgent })
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>()
  const generationRef = useRef(0)
  const viewRef = useRef<SessionView | undefined>(undefined)
  const bufferRef = useRef<SessionEvent[] | null>(null)
  /** 当前会话是否已经发过首条消息；每换一个会话重置一次。 */
  const firstPromptSentRef = useRef(false)
  // 放进 ref，避免调用方传内联函数时把 send 的引用也一起换掉。
  const onFirstPromptRef = useRef(onFirstPrompt)
  const onSessionReadyRef = useRef(onSessionReady)
  // 初始会话 id 只在挂载时锁定：会话建立后回写索引会让 props 变化，
  // 若跟着重连会多闪一次加载态（运行时里已有同一个会话）。跨会话切换靠 key 重挂载。
  const initialSessionIdRef = useRef(initialSessionId)

  useEffect(() => {
    onFirstPromptRef.current = onFirstPrompt
  }, [onFirstPrompt])

  useEffect(() => {
    onSessionReadyRef.current = onSessionReady
  }, [onSessionReady])

  const publishView = useCallback((view: SessionView) => {
    if (viewRef.current?.target.sessionId !== view.target.sessionId) {
      firstPromptSentRef.current = false
    }
    viewRef.current = view
    setSessionId(view.target.sessionId)
    setState(view.state)
    setMessages(view.messages)
  }, [])

  const openSession = useCallback(async (id?: string) => {
    const generation = ++generationRef.current
    bufferRef.current = []
    setSessionLoading(true)
    try {
      assertAcpApi()
      const snapshot = id ? await acp.loadSession(id, cwd, currentAgent) : await acp.createSession(cwd, currentAgent)
      if (generation !== generationRef.current) return
      const target: SessionTarget = { sessionId: snapshot.sessionId, cwd, currentAgent }
      publishView(restoreSessionView(target, snapshot, bufferRef.current ?? []))
      onSessionReadyRef.current?.(snapshot.sessionId)
    } catch (error) {
      if (generation !== generationRef.current) return
      if (viewRef.current) {
        // A capacity/load failure keeps the previous view and its intervening events intact.
        publishView((bufferRef.current ?? []).reduce(applySessionEvent, viewRef.current))
      } else {
        setState({ status: 'error', currentAgent, detail: error instanceof Error ? error.message : '加载会话失败。' })
      }
      throw error
    } finally {
      if (generation === generationRef.current) {
        bufferRef.current = null
        setSessionLoading(false)
      }
    }
  }, [cwd, currentAgent, publishView])

  const connect = useCallback(async () => {
    // load/new owns connection creation; re-entering a live session only reads its snapshot.
    await openSession(initialSessionIdRef.current).catch(() => undefined)
  }, [openSession])

  const target = useCallback((): SessionTarget => {
    if (!viewRef.current || bufferRef.current) throw new Error('当前会话尚未就绪。')
    return viewRef.current.target
  }, [])

  const send = useCallback(async (text: string, attachments: ChatAttachment[] = []) => {
    if (!sessionId) throw new Error('当前会话尚未就绪。')
    const activity = {
      cwd,
      sessionId,
      title: text.replace(/\s+/g, ' ').trim().slice(0, 80) || attachments.map((item) => item.name).join('、').slice(0, 80)
    }
    if (state.status !== 'working') dispatchSessionActivity(activity)
    await acp.prompt({ text, cwd, attachments, target: target() })
    // 发送失败会抛出，此时不触发：外部意图保留，用户重试仍能绑定。
    if (!firstPromptSentRef.current) {
      firstPromptSentRef.current = true
      onFirstPromptRef.current?.(sessionId, activity.title)
    }
  }, [cwd, sessionId, state.status, target])

  const stop = useCallback(async () => {
    await acp.stop(target())
  }, [target])

  const removeQueuedPrompt = useCallback(async (id: string) => {
    await acp.removeQueuedPrompt(id, target())
  }, [target])

  const steerQueuedPrompt = useCallback(async (id: string) => {
    await acp.steerQueuedPrompt(id, target())
  }, [target])

  const setMode = useCallback(async (modeId: string) => {
    await acp.setMode(modeId, target())
  }, [target])

  const setModel = useCallback(async (modelId: string) => {
    await acp.setModel(modelId, target())
  }, [target])

  const setEffort = useCallback(async (effortId: string) => {
    await acp.setEffort(effortId, target())
  }, [target])

  const respondPermission = useCallback(async (optionId: string) => {
    await acp.respondPermission(optionId, target())
  }, [target])

  const listSessions = useCallback(async () => acp.listSessions(cwd), [cwd])

  const loadSession = useCallback((id: string) => openSession(id), [openSession])

  useEffect(() => {
    const receive = (event: SessionEvent): void => {
      if (event.value.cwd !== cwd || event.value.currentAgent !== currentAgent) return
      if (bufferRef.current) {
        bufferRef.current.push(event)
      } else if (viewRef.current) {
        const next = applySessionEvent(viewRef.current, event)
        if (next !== viewRef.current) publishView(next)
      }
    }
    const removeState = acp.onState((value) => receive({ type: 'state', value }))
    const removeMessage = acp.onMessage((value) => receive({ type: 'message', value }))
    // Defer one microtask so StrictMode's discarded effect does not create a spare runtime.
    let disposed = false
    void Promise.resolve().then(() => { if (!disposed) return connect() })
    return () => {
      disposed = true
      generationRef.current++
      bufferRef.current = null
      removeState()
      removeMessage()
    }
  }, [connect, cwd, currentAgent, publishView])

  const value = useMemo<AgentContextValue>(
    () => ({ state, cwd, messages, sessionLoading, sessionId, connect, send, removeQueuedPrompt, steerQueuedPrompt, stop, setMode, setModel, setEffort, respondPermission, listSessions, loadSession }),
    [state, cwd, messages, sessionLoading, sessionId, connect, send, removeQueuedPrompt, steerQueuedPrompt, stop, setMode, setModel, setEffort, respondPermission, listSessions, loadSession]
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

interface DraftAgentProviderProps {
  /** 首条消息提交：由页面创建真实对话（目录 + 索引）并跳到该对话。 */
  onSubmit: (text: string, attachments?: ChatAttachment[]) => Promise<void>
  children: ReactNode
}

/**
 * 草稿会话：从点「对话」到提交首条消息之间还没有目录与真实会话，
 * 这里给出一份可输入的 Agent 上下文，让 ChatComposer 等聊天组件原样复用；
 * 真正的目录与 ACP 会话在 onSubmit 里创建。
 */
export function DraftAgentProvider({ onSubmit, children }: DraftAgentProviderProps): ReactElement {
  const { currentAgent } = useAgentSelection()
  const noop = useCallback(async (): Promise<void> => undefined, [])
  const value = useMemo<AgentContextValue>(
    () => ({
      state: { status: 'draft', currentAgent },
      cwd: '',
      messages: [],
      sessionLoading: false,
      connect: noop,
      send: onSubmit,
      removeQueuedPrompt: noop,
      steerQueuedPrompt: noop,
      stop: noop,
      setMode: noop,
      setModel: noop,
      setEffort: noop,
      respondPermission: noop,
      listSessions: async () => [],
      loadSession: async () => {
        throw new Error('草稿会话尚未创建。')
      }
    }),
    [currentAgent, noop, onSubmit]
  )

  return <AgentContext.Provider value={value}>{children}</AgentContext.Provider>
}
