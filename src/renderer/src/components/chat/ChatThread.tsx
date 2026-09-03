import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type UIEvent, type WheelEvent } from 'react'
import { useAgent } from '@/state/AgentContext'
import { ChatMessageItem } from './ChatMessageItem'

const BOTTOM_THRESHOLD_PX = 24

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

/** 对话消息列表：停留在底部时跟随新内容，用户向上浏览后暂停跟随。 */
export function ChatThread(): ReactElement {
  const { messages, state } = useAgent()
  const scrollRef = useRef<HTMLElement>(null)
  const followsLatestRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const lastUserMessageIdRef = useRef<string | undefined>(undefined)
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

  useLayoutEffect(() => {
    const box = scrollRef.current
    if (!box) return

    // 发送新消息时重新跟随；assistant 流式更新仅在用户仍停留底部时跟随。
    if (latestUserMessageId !== lastUserMessageIdRef.current) {
      followsLatestRef.current = true
      lastUserMessageIdRef.current = latestUserMessageId
    }

    if (followsLatestRef.current) {
      box.scrollTop = box.scrollHeight
      lastScrollTopRef.current = box.scrollTop
    }
  }, [messages, latestUserMessageId])

  const handleScroll = (event: UIEvent<HTMLElement>): void => {
    const box = event.currentTarget
    const distanceFromBottom = box.scrollHeight - box.clientHeight - box.scrollTop

    if (box.scrollTop < lastScrollTopRef.current) {
      followsLatestRef.current = false
    } else if (distanceFromBottom <= BOTTOM_THRESHOLD_PX) {
      followsLatestRef.current = true
    }

    lastScrollTopRef.current = box.scrollTop
  }

  const handleWheel = (event: WheelEvent<HTMLElement>): void => {
    // 在浏览器提交滚动位置前先记录向上浏览意图，避免同一时刻的流式更新抢回滚动位置。
    if (event.deltaY < 0) followsLatestRef.current = false
  }

  return (
    <section
      ref={scrollRef}
      className="chat-thread flex flex-1 flex-col gap-1 overflow-y-auto"
      aria-label="Koala 对话"
      onScroll={handleScroll}
      onWheel={handleWheel}
    >
      {messages.map((message, index) => {
        const summary = turnSummaries.get(index)
        return (
          <Fragment key={message.id}>
            <ChatMessageItem
              message={message}
              streaming={working && message.role === 'assistant' && message.id === latestMessageId}
            />
            {summary && (
              <TurnDurationSummary working={summary.working} startedAt={summary.startedAt} seconds={summary.seconds} />
            )}
          </Fragment>
        )
      })}
    </section>
  )
}
