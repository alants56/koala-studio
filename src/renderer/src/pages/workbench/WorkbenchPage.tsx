import { useEffect, useMemo, useState, type KeyboardEvent, type ReactElement } from 'react'
import { CheckOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ClaudeDailyActivity, ClaudeUsage } from '@shared/claude'

type FrogPeriod = 'daily' | 'weekly'

interface FrogTask {
  id: string
  label: string
  done: boolean
}

interface FrogListProps {
  period: FrogPeriod
  tasks: FrogTask[]
  onAdd: (period: FrogPeriod, label: string) => void
  onToggle: (period: FrogPeriod, id: string) => void
  onDelete: (period: FrogPeriod, id: string) => void
}

const FROG_STORAGE_KEY = 'koala-studio:frog-tasks'

function formatNumber(value: number): string {
  return new Intl.NumberFormat('zh-CN', { notation: value > 9999 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
}

function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}b`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

function formatDuration(milliseconds: number): string {
  if (!milliseconds) return '暂无记录'
  const minutes = Math.floor(milliseconds / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const restMinutes = minutes % 60
  return [days && `${days} 天`, hours && `${hours} 小时`, restMinutes && `${restMinutes} 分`].filter(Boolean).join(' ') || '不足 1 分钟'
}

function formatRefreshTime(iso: string): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso))
}

function localDateKey(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return shifted.toISOString().slice(0, 10)
}

function startOfWeek(date: Date): Date {
  const value = new Date(date)
  const day = value.getDay() || 7
  value.setDate(value.getDate() - day + 1)
  value.setHours(0, 0, 0, 0)
  return value
}

function usageLevel(activity: ClaudeDailyActivity | undefined, maximum: number): number {
  if (!activity?.messageCount || !maximum) return 0
  const ratio = activity.messageCount / maximum
  if (ratio > 0.72) return 4
  if (ratio > 0.42) return 3
  if (ratio > 0.16) return 2
  return 1
}

function FrogList({ period, tasks, onAdd, onToggle, onDelete }: FrogListProps): ReactElement {
  const [value, setValue] = useState('')
  const isDaily = period === 'daily'
  const pending = Math.max(3 - tasks.length, 0)

  const submit = (): void => {
    const label = value.trim()
    if (!label || !pending) return
    onAdd(period, label)
    setValue('')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') submit()
  }

  return (
    <section className={`frog-list frog-list-${period}`} aria-labelledby={`${period}-frogs-title`}>
      <div className="frog-list-heading">
        <div>
          <span className="workbench-kicker">{isDaily ? 'TODAY' : 'THIS WEEK'}</span>
          <h2 id={`${period}-frogs-title`}>{isDaily ? '今天最重要的三只青蛙' : '本周最重要的三只青蛙'}</h2>
        </div>
        <span className="frog-progress">{tasks.filter((task) => task.done).length}/3</span>
      </div>

      <ol className="frog-task-list">
        {[0, 1, 2].map((index) => {
          const task = tasks[index]
          return task ? (
            <li className={`frog-task ${task.done ? 'frog-task-done' : ''}`} key={task.id}>
              <button className="frog-check" type="button" onClick={() => onToggle(period, task.id)} aria-label={task.done ? `标记「${task.label}」未完成` : `完成「${task.label}」`}>
                {task.done && <CheckOutlined />}
              </button>
              <span className="frog-order">0{index + 1}</span>
              <span className="frog-task-label">{task.label}</span>
              <button className="frog-delete" type="button" onClick={() => onDelete(period, task.id)} aria-label={`删除「${task.label}」`} title="删除">
                <DeleteOutlined />
              </button>
            </li>
          ) : (
            <li className="frog-task frog-task-empty" key={`${period}-empty-${index}`}>
              <span className="frog-order">0{index + 1}</span>
              <span>留给真正重要的事</span>
            </li>
          )
        })}
      </ol>

      {pending > 0 && (
        <div className="frog-add-row">
          <input value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={handleKeyDown} placeholder="写下这一只青蛙" aria-label={isDaily ? '添加今天的重要任务' : '添加本周的重要任务'} maxLength={80} />
          <button className="frog-add" type="button" onClick={submit} disabled={!value.trim()} aria-label="添加任务" title="添加任务">
            <PlusOutlined />
          </button>
        </div>
      )}
    </section>
  )
}

/** 工作台：Claude Code 本地统计与三只青蛙待办。 */
export function WorkbenchPage(): ReactElement {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [usageError, setUsageError] = useState(false)
  const [tasks, setTasks] = useState<Record<FrogPeriod, FrogTask[]>>({ daily: [], weekly: [] })

  const loadUsage = async (): Promise<void> => {
    setLoading(true)
    setUsageError(false)
    try {
      setUsage(await window.claude.usage())
    } catch {
      setUsageError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadUsage()
    try {
      const stored = window.localStorage.getItem(FROG_STORAGE_KEY)
      if (stored) setTasks(JSON.parse(stored) as Record<FrogPeriod, FrogTask[]>)
    } catch {
      window.localStorage.removeItem(FROG_STORAGE_KEY)
    }
  }, [])

  const updateTasks = (updater: (previous: Record<FrogPeriod, FrogTask[]>) => Record<FrogPeriod, FrogTask[]>): void => {
    setTasks((previous) => {
      const next = updater(previous)
      window.localStorage.setItem(FROG_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const handleAdd = (period: FrogPeriod, label: string): void => updateTasks((previous) => ({
    ...previous,
    [period]: previous[period].length >= 3 ? previous[period] : [...previous[period], { id: crypto.randomUUID(), label, done: false }]
  }))

  const handleToggle = (period: FrogPeriod, id: string): void => updateTasks((previous) => ({
    ...previous,
    [period]: previous[period].map((task) => task.id === id ? { ...task, done: !task.done } : task)
  }))

  const handleDelete = (period: FrogPeriod, id: string): void => updateTasks((previous) => ({
    ...previous,
    [period]: previous[period].filter((task) => task.id !== id)
  }))

  const activity = useMemo(() => {
    const byDate = new Map(usage?.dailyActivity.map((item) => [item.date, item]))
    const maxMessages = Math.max(...(usage?.dailyActivity.map((item) => item.messageCount) ?? [0]))
    const monday = startOfWeek(new Date())
    monday.setDate(monday.getDate() - 13 * 7)
    return Array.from({ length: 14 }, (_, week) => Array.from({ length: 7 }, (_, day) => {
      const date = new Date(monday)
      date.setDate(date.getDate() + week * 7 + day)
      const key = localDateKey(date)
      const current = byDate.get(key)
      return { key, current, level: usageLevel(current, maxMessages), inFuture: date > new Date() }
    }))
  }, [usage])

  const sevenDayMessages = useMemo(() => {
    if (!usage) return 0
    const start = new Date()
    start.setDate(start.getDate() - 6)
    const startKey = localDateKey(start)
    return usage.dailyActivity.filter((item) => item.date >= startKey).reduce((total, item) => total + item.messageCount, 0)
  }, [usage])

  const favoriteModel = usage?.models[0]
  const totalTokens = usage?.models.reduce((total, model) => total + model.totalTokens, 0) ?? 0

  return (
    <main className="workbench-page">
      <section className="usage-panel" aria-labelledby="usage-title">
        <div className="usage-header">
          <div>
            <span className="workbench-kicker">CLAUDE CODE / LOCAL STATS</span>
            <h1 id="usage-title">用量概览</h1>
            <p>{usage?.lastComputedDate ? `会话记录更新至 ${usage.lastComputedDate}${usage.refreshedAt ? ` · 刷新于 ${formatRefreshTime(usage.refreshedAt)}` : ''}` : '读取本机 Claude Code 会话记录'}</p>
          </div>
          <button className="usage-refresh" type="button" onClick={() => void loadUsage()} disabled={loading} title="刷新统计" aria-label="刷新统计">
            <ReloadOutlined spin={loading} />
          </button>
        </div>

        {usageError ? (
          <div className="usage-message">未能读取 `~/.claude/projects` 下的会话记录。请确认 Claude Code 已在本机运行过。</div>
        ) : loading ? (
          <div className="usage-skeleton" aria-label="正在读取 Claude Code 用量统计" />
        ) : usage ? (
          <>
            <div className="usage-main-grid">
              <div className="usage-heatmap-wrap">
                <div className="usage-heatmap-heading">
                  <span>过去 14 周活跃度</span>
                  <span>按消息数量</span>
                </div>
                <div className="usage-heatmap" role="img" aria-label="Claude Code 过去十四周活跃热力图">
                  <div className="usage-weekdays"><span>一</span><span>三</span><span>五</span></div>
                  <div className="usage-heatmap-grid">
                    {activity.flat().map((item) => <span key={item.key} className={`usage-day usage-day-${item.level} ${item.inFuture ? 'usage-day-future' : ''}`} title={`${item.key}：${item.current?.messageCount ?? 0} 条消息`} />)}
                  </div>
                </div>
                <div className="usage-legend"><span>少</span><i className="usage-day-1" /><i className="usage-day-2" /><i className="usage-day-3" /><i className="usage-day-4" /><span>多</span></div>
              </div>

              <div className="usage-today">
                <span>最近 7 天</span>
                <strong>{formatNumber(sevenDayMessages)}</strong>
                <small>条消息</small>
                <div><b>{formatNumber(usage.totalToolCalls)}</b> 次工具调用</div>
              </div>
            </div>

            <div className="usage-metrics">
              <div><span>会话</span><strong>{formatNumber(usage.totalSessions)}</strong></div>
              <div><span>活跃天</span><strong>{usage.activeDays}</strong></div>
              <div><span>最长会话</span><strong>{formatDuration(usage.longestSessionDuration)}</strong><small>{formatNumber(usage.longestSessionMessages)} 条消息</small></div>
              <div><span>常用模型</span><strong className="usage-model-name">{favoriteModel?.name ?? '暂无记录'}</strong><small>{formatTokens(favoriteModel?.totalTokens ?? 0)} tokens</small></div>
              <div><span>已处理 tokens</span><strong>{formatTokens(totalTokens)}</strong></div>
            </div>
          </>
        ) : null}
      </section>

      <section className="frogs-panel" aria-labelledby="frogs-title">
        <div className="frogs-panel-intro">
          <span className="workbench-kicker">THREE FROGS</span>
          <h1 id="frogs-title">先吃掉最重要的青蛙</h1>
          <p>只选择三件，给真正推动事情的行动留出空间。</p>
        </div>
        <div className="frogs-grid">
          <FrogList period="daily" tasks={tasks.daily} onAdd={handleAdd} onToggle={handleToggle} onDelete={handleDelete} />
          <FrogList period="weekly" tasks={tasks.weekly} onAdd={handleAdd} onToggle={handleToggle} onDelete={handleDelete} />
        </div>
      </section>
    </main>
  )
}
