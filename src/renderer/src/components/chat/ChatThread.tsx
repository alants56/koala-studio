import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type UIEvent, type WheelEvent } from 'react'
import { useAgent } from '@/state/AgentContext'
import { ChatMessageItem } from './ChatMessageItem'

const BOTTOM_THRESHOLD_PX = 24
/** 初始只渲染最近的若干条消息，其余历史在向上滑动时按批补载。 */
const INITIAL_RENDER_COUNT = 30
/** 每次向上滑动补载的消息条数。 */
const OLDER_REVEAL_COUNT = 30
/** 距当前渲染内容顶部多远时触发补载。 */
const LOAD_MORE_TRIGGER_PX = 180

/** 把秒数格式化为紧凑的人类可读形式：3m 17s / 1h 2m 3s / 12s。 */
function formatTurnDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

/** 当前 turn 执行时间摘要：位于用户气泡下方、agent 回复上方。 */
function TurnDurationSummary({ working, startedAt, seconds }: { working: boolean; startedAt?: number; seconds?: number }): ReactElement {
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (!working || startedAt == null) return
    const update = (): void => setNow(Math.max(0, Date.now() - startedAt))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [working, startedAt])

  const elapsed = working && startedAt != null ? Math.floor(now / 1000) : seconds ?? 0

  return (
    <div className="chat-turn-summary" role="status" aria-live="polite">
      <span className="chat-turn-summary-label">用时 {formatTurnDuration(elapsed)}</span>
      <span className="chat-turn-summary-arrow" aria-hidden="true">›</span>
    </div>
  )
}

/** 对话消息列表：停留在底部时跟随新内容，用户向上浏览后暂停跟随。
 * 历史会话反向补载——仅在进入时渲染最近的若干条，向上滑动再逐批加载更早的消息。 */
export function ChatThread(): ReactElement {
  const { messages, sessionId } = useAgent()
  // 切换会话或首批历史到达时，重新从最新一批开始，不能沿用旧会话的下标。
  return <ChatThreadMessages key={JSON.stringify([sessionId, messages[0]?.id])} />
}

function ChatThreadMessages(): ReactElement {
  const { messages, state, cwd } = useAgent()
  const scrollRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const followsLatestRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const lastUserMessageIdRef = useRef<string | undefined>(undefined)
  /** 当前要渲染的起始下标：下标之前的少量消息尚未渲染，向上滑动时递减补载。 */
  const [startIndex, setStartIndex] = useState(() => Math.max(0, messages.length - INITIAL_RENDER_COUNT))
  const startIndexRef = useRef(startIndex)
  /** 记录正在阅读的元素及其视口位置，补载和异步排版都保持该锚点。 */
  const viewportAnchorRef = useRef<{ element: Element; top: number } | undefined>(undefined)
  startIndexRef.current = startIndex

  const latestMessageId = messages[messages.length - 1]?.id
  const latestUserMessageId = messages.findLast((message) => message.role === 'user')?.id
  const lastUserIndex = messages.findLastIndex((message) => message.role === 'user')
  const working = state.status === 'working'

  // 为每个用户消息计算该轮总耗时，展示在其所属 agent 回复上方。
  // - 已收尾的轮次：用助手消息的 finishedAt − 用户消息 createdAt 精确计算（存的是真实结束时间）。
  // - 进行中 / 刚结束的最近一轮：finishedAt 尚为空，退回用 state 的 turn 计时兜底。
  interface TurnSummaryProps {
    working: boolean
    startedAt?: number
    seconds?: number
  }
  const turnSummaries = new Map<number, TurnSummaryProps>()
  messages.forEach((message, index) => {
    if (message.role !== 'user') return
    // 该轮消息范围：到下一个用户消息为止（避免把后续轮次的回复算进来）。
    const nextUserIndex = messages.findIndex((item, i) => i > index && item.role === 'user')
    const turnMsgs = nextUserIndex === -1 ? messages.slice(index + 1) : messages.slice(index + 1, nextUserIndex)
    const reply = turnMsgs.findLast((item) => item.role === 'assistant' && item.kind !== 'thinking' && item.content)
    if (reply?.finishedAt) {
      const total = Math.max(0, Math.round((new Date(reply.finishedAt).getTime() - new Date(message.createdAt).getTime()) / 1000))
      turnSummaries.set(index, { working: false, seconds: total })
    } else if (index === lastUserIndex && (working || state.lastTurnSeconds != null)) {
      turnSummaries.set(index, { working, startedAt: state.workStartedAt, seconds: state.lastTurnSeconds })
    }
  })

  const rememberViewport = useCallback((): void => {
    const box = scrollRef.current
    const content = contentRef.current
    if (!box || !content) return
    const top = box.getBoundingClientRect().top
    const element = Array.from(content.children).find((child) => (
      !child.classList.contains('chat-load-more') && child.getBoundingClientRect().bottom > top
    ))
    viewportAnchorRef.current = element ? { element, top: element.getBoundingClientRect().top - top } : undefined
  }, [])

  const restoreViewport = useCallback((): void => {
    const box = scrollRef.current
    if (!box) return
    if (followsLatestRef.current) {
      // 必须在绘制前瞬时定位；不能让平滑滚动暴露从旧消息向下滑动的过程。
      box.scrollTop = box.scrollHeight
    } else {
      const anchor = viewportAnchorRef.current
      if (anchor?.element.isConnected) {
        box.scrollTop += anchor.element.getBoundingClientRect().top - box.getBoundingClientRect().top - anchor.top
      }
    }
    lastScrollTopRef.current = box.scrollTop
    rememberViewport()
  }, [rememberViewport])

  /** 把更早的消息插入顶部，不改变当前阅读位置（点击补载也不回到底部）。 */
  const loadOlder = useCallback((): void => {
    if (startIndexRef.current <= 0) return
    followsLatestRef.current = false
    rememberViewport()
    setStartIndex((current) => Math.max(0, current - OLDER_REVEAL_COUNT))
  }, [rememberViewport])

  useLayoutEffect(() => {
    // 发送新消息时重新跟随；assistant 流式更新仅在用户仍停留底部时跟随。
    if (latestUserMessageId !== lastUserMessageIdRef.current) {
      followsLatestRef.current = true
      lastUserMessageIdRef.current = latestUserMessageId
    }

    restoreViewport()
  }, [messages, latestUserMessageId, startIndex, restoreViewport])

  useLayoutEffect(() => {
    const box = scrollRef.current
    const content = contentRef.current
    if (!box || !content) return
    // Markdown、图片及折叠区可能在 React 提交后才撑高；同时处理窗口尺寸变化。
    const observer = new ResizeObserver(restoreViewport)
    observer.observe(content)
    observer.observe(box)
    return () => observer.disconnect()
  }, [restoreViewport])

  const handleScroll = (event: UIEvent<HTMLElement>): void => {
    const box = event.currentTarget
    const distanceFromBottom = box.scrollHeight - box.clientHeight - box.scrollTop

    const scrolledUp = box.scrollTop < lastScrollTopRef.current
    if (scrolledUp) {
      followsLatestRef.current = false
    } else if (distanceFromBottom <= BOTTOM_THRESHOLD_PX) {
      followsLatestRef.current = true
    }

    // 用户正在向上浏览、且接近当前渲染内容顶部时，补载更早的消息（反向加载）。
    // 仅向上滑动才触发，避免补载锚定后视口下移引发连轴补载。
    if (scrolledUp && startIndexRef.current > 0 && box.scrollTop <= LOAD_MORE_TRIGGER_PX) {
      loadOlder()
    }

    lastScrollTopRef.current = box.scrollTop
    rememberViewport()
  }

  const handleWheel = (event: WheelEvent<HTMLElement>): void => {
    // 在浏览器提交滚动位置前先记录向上浏览意图，避免同一时刻的流式更新抢回滚动位置。
    if (event.deltaY < 0) {
      followsLatestRef.current = false
      // 内容尚不足一屏时也可以继续向上补载，不依赖一定发生 scroll 事件。
      if (event.currentTarget.scrollTop <= LOAD_MORE_TRIGGER_PX) loadOlder()
    }
  }

  const visibleMessages = startIndex > 0 ? messages.slice(startIndex) : messages

  return (
    <section
      ref={scrollRef}
      className="chat-thread flex-1 min-h-0 overflow-y-auto"
      aria-label="Koala 对话"
      onScroll={handleScroll}
      onWheel={handleWheel}
    >
      <div ref={contentRef} className="chat-thread-content flex flex-col gap-1">
        {startIndex > 0 && (
          <button
            type="button"
            className="chat-load-more"
            onClick={loadOlder}
            title={`还有 ${startIndex} 条更早的消息`}
          >
            加载更早消息（{startIndex}）
          </button>
        )}
        {visibleMessages.map((message, offset) => {
          const index = startIndex + offset
          const summary = turnSummaries.get(index)
          return (
            <Fragment key={message.id}>
              <ChatMessageItem
                message={message}
                cwd={cwd}
                streaming={working && message.role === 'assistant' && message.id === latestMessageId}
              />
              {summary && (
                <TurnDurationSummary working={summary.working} startedAt={summary.startedAt} seconds={summary.seconds} />
              )}
            </Fragment>
          )
        })}
      </div>
    </section>
  )
}
