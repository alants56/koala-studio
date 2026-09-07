import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import type { AcpSessionInfo, AgentState, ChatMessage, SessionTarget } from '@shared/acp'
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
  const { currentAgent } = useAgentSelection()
  const agentName = currentAgent === 'pi' ? 'Pi' : 'Claude'
  // 进入页面即视为「连接中」，避免首帧先闪现「未连接」
  const [state, setState] = useState<AgentState>({ status: 'connecting', detail: `正在连接 ${agentName} ACP…`, currentAgent })
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL_MESSAGES)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>()
  const generationRef = useRef(0)
  const viewRef = useRef<SessionView | undefined>(undefined)
  const bufferRef = useRef<SessionEvent[] | null>(null)

  const publishView = useCallback((view: SessionView) => {
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
    await openSession(initialSessionId).catch(() => undefined)
  }, [initialSessionId, openSession])

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
  const createNewSession = useCallback(() => openSession(), [openSession])

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
    () => ({ state, cwd, messages, sessionLoading, sessionId, connect, send, removeQueuedPrompt, steerQueuedPrompt, stop, setMode, setModel, setEffort, respondPermission, listSessions, loadSession, createNewSession }),
    [state, cwd, messages, sessionLoading, sessionId, connect, send, removeQueuedPrompt, steerQueuedPrompt, stop, setMode, setModel, setEffort, respondPermission, listSessions, loadSession, createNewSession]
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
