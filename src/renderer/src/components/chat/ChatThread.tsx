import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement, type UIEvent, type WheelEvent } from 'react'
import { ThoughtChain } from '@ant-design/x'
import type { ChatMessage } from '@/models'
import { useAgent } from '@/state/AgentContext'
import { formatTurnDuration } from '@/utils/turn-duration'
import { ChatMessageItem } from './ChatMessageItem'

const BOTTOM_THRESHOLD_PX = 24
/** 初始只渲染最近的若干条消息，其余历史在向上滑动时按批补载。 */
const INITIAL_RENDER_COUNT = 30
/** 每次向上滑动补载的消息条数。 */
const OLDER_REVEAL_COUNT = 30
/** 距当前渲染内容顶部多远时触发补载。 */
const LOAD_MORE_TRIGGER_PX = 180

/** ACP 工具类别 → 摘要里用的中文动作短语。 */
const TOOL_KIND_ACTIONS: Record<string, string> = {
  read: '读取文件',
  edit: '修改文件',
  delete: '删除文件',
  move: '移动文件',
  search: '搜索代码',
  execute: '运行命令',
  fetch: '获取网页',
  think: '思考',
  switch_mode: '切换模式'
}

/** 用这一组步骤做过的事生成摘要，同类别只保留一次，例如「已读取文件、运行命令」。 */
function summarizeActivity(messages: ChatMessage[]): string {
  const actions: string[] = []
  const seen = new Set<string>()
  for (const message of messages) {
    const action = message.kind === 'thinking'
      ? '思考'
      : TOOL_KIND_ACTIONS[message.toolKind ?? ''] ?? '调用工具'
    if (seen.has(action)) continue
    seen.add(action)
    actions.push(action)
  }
  return actions.length > 0 ? `已${actions.join('、')}` : '执行过程'
}

/** 边生成边收拢的思考 + 工具调用：默认折叠，展开后是逐条明细。
 *  分组头不带成功 / 失败图标，也不做红色强调——保持中性。有工具失败时自动展开，
 *  让用户直接看到是哪一步出错，而不是靠颜色喊。 */
function ActivityGroupMessage({ messages, cwd, live }: { messages: ChatMessage[]; cwd?: string; live?: boolean }): ReactElement {
  const failed = messages.some((message) => message.toolStatus === 'failed')
  // 实时聚合让分组在生成途中就已挂载，defaultExpandedKeys 不再生效：
  // 改为受控展开，一出现失败就展开（用户手动收起后不再抢回）。
  const [expandedKeys, setExpandedKeys] = useState<string[]>(() => (failed ? ['group'] : []))
  const listRef = useRef<HTMLDivElement>(null)
  /** 展开的实时分组默认贴底；用户自己往上滚后暂停跟随。 */
  const followListRef = useRef(true)

  useEffect(() => {
    if (failed) setExpandedKeys((current) => (current.includes('group') ? current : ['group']))
  }, [failed])

  // 展开（或收起后再展开）时贴底，避免实时分组停在最早几步。
  const attachList = useCallback((node: HTMLDivElement | null): void => {
    listRef.current = node
    if (node && live) {
      followListRef.current = true
      node.scrollTop = node.scrollHeight
    }
  }, [live])

  // 分组展开期间持续贴底：每次重渲后都跟到最新一步，
  // 工具输出这类原地变高的内容也不会把位置留在中间。
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || !live || !followListRef.current) return
    list.scrollTop = list.scrollHeight
  })

  const handleListScroll = (): void => {
    const list = listRef.current
    if (!list) return
    followListRef.current = list.scrollHeight - list.clientHeight - list.scrollTop <= BOTTOM_THRESHOLD_PX
  }

  // 滚轮向上先标记停止跟随：浏览器提交滚动位置前，流式重渲可能先把位置抢回底部。
  const handleListWheel = (event: WheelEvent<HTMLDivElement>): void => {
    if (event.deltaY < 0) followListRef.current = false
  }

  return (
    <ThoughtChain
      className={`chat-activity-message chat-activity-group mr-auto${live ? ' is-live' : ''}`}
      expandedKeys={expandedKeys}
      onExpand={setExpandedKeys}
      line={false}
      items={[
        {
          key: 'group',
          icon: false,
          title: (
            <span>
              {summarizeActivity(messages)}
              <span className="chat-activity-group-meta"> · {messages.length} 步</span>
            </span>
          ),
          collapsible: true,
          content: (
            <div className="chat-activity-group-list" ref={attachList} onScroll={handleListScroll} onWheel={handleListWheel}>
              {messages.map((message) => <ChatMessageItem key={message.id} message={message} cwd={cwd} />)}
            </div>
          )
        }
      ]}
    />
  )
}

/** 已完成 turn 的执行时间：位于该轮用户气泡下方、agent 回复上方。
 *  进行中那一轮的实时用时在输入区（「停止」左侧），不在这里重复。 */
function TurnDurationSummary({ seconds }: { seconds: number }): ReactElement {
  return (
    <div className="chat-turn-summary">
      <span className="chat-turn-summary-label">用时 {formatTurnDuration(seconds)}</span>
      <span className="chat-turn-summary-arrow" aria-hidden="true">›</span>
    </div>
  )
}

/** 聚合明细 / 工具输出是嵌套滚动区：在它们内部滚轮优先滚动自己，
 *  只有滚到边界（上滑到顶 / 下滑到底）后，才把剩余位移接力给外层会话。
 *  返回从事件目标向上找到的第一个真正可滚动的嵌套滚动区。 */
function findNestedScroller(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (!node.matches('.chat-activity-group-list, .chat-tool-output')) continue
    const element = node as HTMLElement
    if (element.scrollHeight - element.clientHeight > 1) return element
  }
  return null
}

/** 该滚动区在滚轮方向上是否还有内容可滚（留 1px 误差，macOS 触控板会有小数）。 */
function canScrollOn(node: HTMLElement, deltaY: number): boolean {
  if (deltaY < 0) return node.scrollTop > 1
  return node.scrollTop < node.scrollHeight - node.clientHeight - 1
}

/** 把滚轮位移统一成像素，避免 line / page 模式下位移被放大或缩小。 */
function wheelDeltaPx(event: WheelEvent<HTMLElement>): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * event.currentTarget.clientHeight
  return event.deltaY
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

  // 为每个已收尾的用户消息计算该轮总耗时，展示在其所属 agent 回复上方。
  // - 常规：助手消息的 finishedAt − 用户消息 createdAt（存的是真实结束时间）。
  // - 刚结束、回复尚无 finishedAt 的最近一轮：退回 state 的 turn 计时兜底。
  const turnSummaries = new Map<number, number>()
  messages.forEach((message, index) => {
    if (message.role !== 'user') return
    // 该轮消息范围：到下一个用户消息为止（避免把后续轮次的回复算进来）。
    const nextUserIndex = messages.findIndex((item, i) => i > index && item.role === 'user')
    const turnMsgs = nextUserIndex === -1 ? messages.slice(index + 1) : messages.slice(index + 1, nextUserIndex)
    const reply = turnMsgs.findLast((item) => item.role === 'assistant' && item.kind !== 'thinking' && item.content)
    if (reply?.finishedAt) {
      turnSummaries.set(index, Math.max(0, Math.round((new Date(reply.finishedAt).getTime() - new Date(message.createdAt).getTime()) / 1000)))
    } else if (!working && index === lastUserIndex && state.lastTurnSeconds != null) {
      turnSummaries.set(index, state.lastTurnSeconds)
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
    const nested = findNestedScroller(event.target)
    // 嵌套滚动区自己还能滚时，滚轮只作用于它：不影响会话跟随，也不触发反向补载。
    if (nested && canScrollOn(nested, event.deltaY)) return

    // 嵌套区已到边界：原生 chaining 被 overscroll-behavior: contain 关掉了，
    // 这里手动接力，让「上滑到顶后继续上滑」等价于直接滚外层会话。
    if (nested) event.currentTarget.scrollTop += wheelDeltaPx(event)

    // 在浏览器提交滚动位置前先记录向上浏览意图，避免同一时刻的流式更新抢回滚动位置。
    if (event.deltaY < 0) {
      followsLatestRef.current = false
      // 内容尚不足一屏时也可以继续向上补载，不依赖一定发生 scroll 事件。
      if (event.currentTarget.scrollTop <= LOAD_MORE_TRIGGER_PX) loadOlder()
    }
  }

  // 思考 / 工具调用边生成边收拢成一条摘要（实时聚合），不等该轮结束：
  // 消息一到就并入分组，摘要与步数随生成更新，收尾时也不会整段突然塌缩。
  // 分组内每个下标都指向同一个数组：反向补载可能把分组切在中间，
  // 渲染时要在它第一条可见的消息处补上，否则整组会凭空消失。
  const groupByIndex = new Map<number, ChatMessage[]>()
  /** 仍在接收新步骤的分组（即最后一个活动分组），展开时让它跟随最新一步。 */
  let liveGroup: ChatMessage[] | undefined
  {
    let open: ChatMessage[] | undefined
    messages.forEach((message, index) => {
      if (message.role === 'user') {
        open = undefined
        return
      }
      // 助手正文把连续的活动切段，保证收拢后阅读顺序不变。
      if (message.kind !== 'thinking' && message.kind !== 'tool') {
        open = undefined
        return
      }
      open ??= []
      open.push(message)
      groupByIndex.set(index, open)
    })
    liveGroup = open
  }

  const visibleMessages = startIndex > 0 ? messages.slice(startIndex) : messages
  const entries: ReactElement[] = []
  const renderedGroups = new Set<ChatMessage[]>()
  visibleMessages.forEach((message, offset) => {
    const index = startIndex + offset
    const group = groupByIndex.get(index)
    if (group) {
      if (renderedGroups.has(group)) return
      renderedGroups.add(group)
      entries.push(
        <Fragment key={group[0].id}>
          <ActivityGroupMessage messages={group} cwd={cwd} live={working && group === liveGroup} />
        </Fragment>
      )
      return
    }
    const seconds = turnSummaries.get(index)
    entries.push(
      <Fragment key={message.id}>
        <ChatMessageItem
          message={message}
          cwd={cwd}
          streaming={working && message.role === 'assistant' && message.id === latestMessageId}
        />
        {seconds != null && <TurnDurationSummary seconds={seconds} />}
      </Fragment>
    )
  })

  return (
    <section
      ref={scrollRef}
      className="chat-thread flex-1 min-h-0 overflow-y-auto"
      aria-label="Koala 对话"
      onScroll={handleScroll}
      onWheel={handleWheel}
    >
      <div ref={contentRef} className="chat-thread-content flex flex-col gap-0.5">
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
        {entries}
      </div>
    </section>
  )
}
