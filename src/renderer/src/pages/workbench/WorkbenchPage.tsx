import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react'
import { CalendarOutlined, CheckOutlined, DeleteOutlined, EditOutlined, FlagFilled, FlagOutlined, LeftOutlined, MessageOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons'
import { Modal } from 'antd'
import { useNavigate } from 'react-router-dom'
import type { AcpSessionInfo } from '@shared/acp'
import { useProjects } from '@/state/ProjectsContext'
import { WORKSPACE_PATH } from '@/utils/constants'

interface ScheduleItem {
  id: string
  date: string
  time: string
  title: string
}

interface TodoItem {
  id: string
  title: string
  done: boolean
  important: boolean
  projectId?: string
  sessionId?: string
  sessionTitle?: string
}

interface WorkspaceData {
  schedule: ScheduleItem[]
  todos: TodoItem[]
}

const WORKSPACE_STORAGE_KEY = 'koala-studio:workspace-v3'
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function calendarDays(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(first.getDate() - mondayOffset)
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

function displayDate(dateKey: string): string {
  const date = new Date(`${dateKey}T12:00:00`)
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(date)
}

/** 工作台：紧凑日程、项目关联待办与工作状态。 */
export function WorkbenchPage(): ReactElement {
  const navigate = useNavigate()
  const { projects } = useProjects()
  const today = useMemo(() => localDateKey(new Date()), [])
  const [data, setData] = useState<WorkspaceData>({ schedule: [], todos: [] })
  const [selectedDate, setSelectedDate] = useState(today)
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [scheduleTime, setScheduleTime] = useState('09:00')
  const [scheduleTitle, setScheduleTitle] = useState('')
  const [todoTitle, setTodoTitle] = useState('')
  const [todoProjectId, setTodoProjectId] = useState('')
  const [todoSessionId, setTodoSessionId] = useState('')
  const [todoSessionTitle, setTodoSessionTitle] = useState('')
  const [associationDialogOpen, setAssociationDialogOpen] = useState(false)
  const [draftProjectId, setDraftProjectId] = useState('')
  const [draftSessionId, setDraftSessionId] = useState('')
  const [todoSessions, setTodoSessions] = useState<AcpSessionInfo[]>([])
  const [sessionLoadState, setSessionLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [editingTodoId, setEditingTodoId] = useState<string>()
  const [editTodoTitle, setEditTodoTitle] = useState('')
  const [editTodoDone, setEditTodoDone] = useState(false)
  const [editProjectId, setEditProjectId] = useState('')
  const [editSessionId, setEditSessionId] = useState('')
  const [editSessionTitle, setEditSessionTitle] = useState('')
  const [editSessions, setEditSessions] = useState<AcpSessionInfo[]>([])
  const [editSessionLoadState, setEditSessionLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [todoView, setTodoView] = useState<'active' | 'done'>('active')

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(WORKSPACE_STORAGE_KEY)
      if (stored) setData(JSON.parse(stored) as WorkspaceData)
    } catch {
      window.localStorage.removeItem(WORKSPACE_STORAGE_KEY)
    }
  }, [])

  useEffect(() => {
    const project = projects.find((item) => item.id === draftProjectId)
    setTodoSessions([])

    if (!project) {
      setSessionLoadState('idle')
      return
    }

    let cancelled = false
    setSessionLoadState('loading')
    void window.acp.listSessions(project.path ?? WORKSPACE_PATH)
      .then((sessions) => {
        if (cancelled) return
        setTodoSessions(sessions)
        setSessionLoadState('idle')
      })
      .catch(() => {
        if (cancelled) return
        setSessionLoadState('error')
      })

    return () => {
      cancelled = true
    }
  }, [draftProjectId, projects])

  useEffect(() => {
    const project = projects.find((item) => item.id === editProjectId)
    setEditSessions([])

    if (!project) {
      setEditSessionLoadState('idle')
      return
    }

    let cancelled = false
    setEditSessionLoadState('loading')
    void window.acp.listSessions(project.path ?? WORKSPACE_PATH)
      .then((sessions) => {
        if (cancelled) return
        setEditSessions(sessions)
        setEditSessionLoadState('idle')
      })
      .catch(() => {
        if (cancelled) return
        setEditSessionLoadState('error')
      })

    return () => {
      cancelled = true
    }
  }, [editProjectId, projects])

  const updateData = (updater: (previous: WorkspaceData) => WorkspaceData): void => {
    setData((previous) => {
      const next = updater(previous)
      window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }

  const addSchedule = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const title = scheduleTitle.trim()
    if (!title) return
    updateData((previous) => ({
      ...previous,
      schedule: [...previous.schedule, { id: crypto.randomUUID(), date: selectedDate, time: scheduleTime, title }]
        .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
    }))
    setScheduleTitle('')
  }

  const addTodo = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const title = todoTitle.trim()
    if (!title) return
    updateData((previous) => ({
      ...previous,
      todos: [{ id: crypto.randomUUID(), title, done: false, important: false, projectId: todoProjectId || undefined, sessionId: todoSessionId || undefined, sessionTitle: todoSessionTitle || undefined }, ...previous.todos]
    }))
    setTodoTitle('')
    setTodoProjectId('')
    setTodoSessionId('')
    setTodoSessionTitle('')
  }

  const toggleTodo = (id: string): void => updateData((previous) => ({ ...previous, todos: previous.todos.map((todo) => todo.id === id ? { ...todo, done: !todo.done } : todo) }))
  const toggleImportant = (id: string): void => updateData((previous) => ({ ...previous, todos: previous.todos.map((todo) => todo.id === id ? { ...todo, important: !todo.important } : todo) }))
  const removeTodo = (id: string): void => updateData((previous) => ({ ...previous, todos: previous.todos.filter((todo) => todo.id !== id) }))
  const removeSchedule = (id: string): void => updateData((previous) => ({ ...previous, schedule: previous.schedule.filter((item) => item.id !== id) }))

  const calendar = useMemo(() => calendarDays(calendarMonth), [calendarMonth])
  const scheduledDates = useMemo(() => new Set(data.schedule.map((item) => item.date)), [data.schedule])
  const selectedSchedule = data.schedule.filter((item) => item.date === selectedDate)
  const visibleTodos = data.todos.filter((todo) => todoView === 'done' ? todo.done : !todo.done)
  const completed = data.todos.filter((todo) => todo.done).length
  const active = data.todos.length - completed
  const important = data.todos.filter((todo) => todo.important && !todo.done)
  const linkedProjects = new Set(data.todos.map((todo) => todo.projectId).filter(Boolean)).size

  const selectDate = (date: Date): void => {
    setSelectedDate(localDateKey(date))
    if (date.getMonth() !== calendarMonth.getMonth() || date.getFullYear() !== calendarMonth.getFullYear()) {
      setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1))
    }
  }

  const openAssociationDialog = (): void => {
    setDraftProjectId(todoProjectId)
    setDraftSessionId(todoSessionId)
    setAssociationDialogOpen(true)
  }

  const applyAssociation = (): void => {
    const session = todoSessions.find((item) => item.sessionId === draftSessionId)
    if (!session) return
    setTodoProjectId(draftProjectId)
    setTodoSessionId(session.sessionId)
    setTodoSessionTitle(session.title || '未命名会话')
    setAssociationDialogOpen(false)
  }

  const clearAssociation = (): void => {
    setTodoProjectId('')
    setTodoSessionId('')
    setTodoSessionTitle('')
    setAssociationDialogOpen(false)
  }

  const openTodoEditor = (todo: TodoItem): void => {
    setEditingTodoId(todo.id)
    setEditTodoTitle(todo.title)
    setEditTodoDone(todo.done)
    setEditProjectId(todo.projectId || '')
    setEditSessionId(todo.sessionId || '')
    setEditSessionTitle(todo.sessionTitle || '')
  }

  const saveTodoEdit = (): void => {
    const title = editTodoTitle.trim()
    if (!title || !editingTodoId) return
    updateData((previous) => ({
      ...previous,
      todos: previous.todos.map((todo) => {
        if (todo.id !== editingTodoId) return todo
        const selectedSession = editSessions.find((session) => session.sessionId === editSessionId)
        return {
          ...todo,
          title,
          done: editTodoDone,
          projectId: editProjectId || undefined,
          sessionId: editSessionId || undefined,
          sessionTitle: selectedSession?.title || (todo.sessionId === editSessionId ? todo.sessionTitle : undefined)
        }
      })
    }))
    setEditingTodoId(undefined)
  }

  const clearEditAssociation = (): void => {
    setEditProjectId('')
    setEditSessionId('')
    setEditSessionTitle('')
  }

  return (
    <main className="workbench-page">
      <section className="calendar-panel" aria-labelledby="calendar-title">
        <div className="calendar-frame">
          <div className="calendar-heading">
            <div>
              <span className="workbench-kicker">SCHEDULE</span>
              <h1 id="calendar-title">日程</h1>
            </div>
            <div className="calendar-nav">
              <button type="button" className="workspace-icon-button" onClick={() => setCalendarMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))} aria-label="上个月" title="上个月"><LeftOutlined /></button>
              <span>{new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long' }).format(calendarMonth)}</span>
              <button type="button" className="workspace-icon-button" onClick={() => setCalendarMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))} aria-label="下个月" title="下个月"><RightOutlined /></button>
            </div>
          </div>
          <div className="calendar-weekdays">{WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
          <div className="calendar-grid" role="grid" aria-label="日程日历">
            {calendar.map((date) => {
              const dateKey = localDateKey(date)
              const outside = date.getMonth() !== calendarMonth.getMonth()
              const hasSchedule = scheduledDates.has(dateKey)
              return <button key={dateKey} type="button" role="gridcell" className={`calendar-day ${outside ? 'calendar-day-outside' : ''} ${dateKey === selectedDate ? 'calendar-day-selected' : ''} ${dateKey === today ? 'calendar-day-today' : ''} ${hasSchedule ? 'calendar-day-scheduled' : ''}`} onClick={() => selectDate(date)} aria-label={displayDate(dateKey)}>{date.getDate()}</button>
            })}
          </div>
        </div>

        <div className="calendar-agenda">
          <div className="agenda-heading"><span>{displayDate(selectedDate)}</span><b>{selectedSchedule.length} 项</b></div>
          <div className="agenda-list">
            {selectedSchedule.length ? selectedSchedule.map((item) => (
              <div className="agenda-item" key={item.id}><time>{item.time}</time><span>{item.title}</span><button type="button" className="workspace-icon-button agenda-delete" onClick={() => removeSchedule(item.id)} aria-label={`删除日程「${item.title}」`} title="删除日程"><DeleteOutlined /></button></div>
            )) : <p>这一天没有日程</p>}
          </div>
          <form className="agenda-add" onSubmit={addSchedule}>
            <input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} aria-label="日程时间" />
            <input value={scheduleTitle} onChange={(event) => setScheduleTitle(event.target.value)} placeholder="添加事项" aria-label="添加日程事项" maxLength={80} />
            <button className="workspace-icon-button workspace-add" type="submit" disabled={!scheduleTitle.trim()} aria-label="添加日程" title="添加日程"><PlusOutlined /></button>
          </form>
        </div>
      </section>

      <div className="workspace-bottom-grid">
        <section className="todos-panel" aria-labelledby="todos-title">
          <div className="todos-heading-row">
            <div className="workbench-section-heading"><div><span className="workbench-kicker">TO-DO</span><h1 id="todos-title">待办事项</h1></div></div>
            <div className="todo-filters" role="tablist" aria-label="待办筛选">
              <button type="button" role="tab" aria-selected={todoView === 'active'} className={todoView === 'active' ? 'todo-filter-active' : ''} onClick={() => setTodoView('active')}>进行中 {active}</button>
              <button type="button" role="tab" aria-selected={todoView === 'done'} className={todoView === 'done' ? 'todo-filter-active' : ''} onClick={() => setTodoView('done')}>已完成 {completed}</button>
            </div>
          </div>
          <form className="todo-add" onSubmit={addTodo}>
            <input value={todoTitle} onChange={(event) => setTodoTitle(event.target.value)} placeholder="添加待办事项" aria-label="添加待办事项" maxLength={100} />
            <button type="button" className={`todo-session-trigger ${todoSessionId ? 'todo-session-trigger-linked' : ''}`} onClick={openAssociationDialog} title={todoSessionId ? `已关联「${todoSessionTitle}」` : '关联会话'}><MessageOutlined /><span>{todoSessionId ? todoSessionTitle : '关联会话'}</span></button>
            <button className="workspace-icon-button workspace-add" type="submit" disabled={!todoTitle.trim()} aria-label="添加待办" title="添加待办"><PlusOutlined /></button>
          </form>
          {visibleTodos.length === 0 ? (
            <div className="todo-empty"><CalendarOutlined /><span>{data.todos.length ? '这个视图没有待办事项' : '从一件待办开始今天的工作'}</span></div>
          ) : (
            <ul className="todo-list">
              {visibleTodos.map((todo) => {
                const project = todo.projectId ? projects.find((item) => item.id === todo.projectId) : undefined
                const sessionProjectId = project?.id
                const sessionLink = sessionProjectId && todo.sessionId ? `${project?.name} · ${todo.sessionTitle || '会话'}` : undefined
                return <li className={`todo-item ${todo.done ? 'todo-item-done' : ''}`} key={todo.id}>
                  <button type="button" className="todo-check" onClick={() => toggleTodo(todo.id)} aria-label={todo.done ? `标记「${todo.title}」未完成` : `完成「${todo.title}」`}>{todo.done && <CheckOutlined />}</button>
                  <div className="todo-copy"><span className="todo-item-label">{todo.title}</span>{sessionLink ? <button type="button" className="todo-project-link" onClick={() => void navigate(`/projects/${sessionProjectId}?session=${encodeURIComponent(todo.sessionId!)}`)} title={`进入会话「${todo.sessionTitle || '未命名会话'}」`}><MessageOutlined />{sessionLink}</button> : project && <button type="button" className="todo-project-link" onClick={() => void navigate(`/projects/${project.id}`)} title={`进入「${project.name}」对话`}><MessageOutlined />{project.name}</button>}</div>
                  <button type="button" className="workspace-icon-button todo-edit" onClick={() => openTodoEditor(todo)} aria-label={`编辑待办「${todo.title}」`} title="编辑待办"><EditOutlined /></button>
                  <button type="button" className={`todo-important ${todo.important ? 'todo-important-active' : ''}`} onClick={() => toggleImportant(todo.id)} aria-label={todo.important ? `取消标记「${todo.title}」为重点` : `标记「${todo.title}」为重点`} title={todo.important ? '取消重点' : '标记重点'}>{todo.important ? <FlagFilled /> : <FlagOutlined />}</button>
                  <button type="button" className="workspace-icon-button todo-delete" onClick={() => removeTodo(todo.id)} aria-label={`删除待办「${todo.title}」`} title="删除待办"><DeleteOutlined /></button>
                </li>
              })}
            </ul>
          )}
        </section>

        <aside className="status-panel" aria-labelledby="status-title">
          <span className="workbench-kicker">WORK STATUS</span>
          <h2 id="status-title">工作状态</h2>
          <div className="status-overview"><strong>{completed}</strong><span>已完成</span><b>/ {data.todos.length}</b></div>
          <div className="status-lines"><div><span>待处理</span><b>{active}</b></div><div><span>重点</span><b>{important.length}</b></div><div><span>关联项目</span><b>{linkedProjects}</b></div></div>
          <div className="status-focus"><span>当前重点</span>{important.length ? <ul>{important.slice(0, 3).map((todo) => <li key={todo.id}>{todo.title}</li>)}</ul> : <p>标记待办为重点后会显示在这里</p>}</div>
        </aside>
      </div>

      <Modal open={associationDialogOpen} onCancel={() => setAssociationDialogOpen(false)} footer={null} title="关联 Claude 会话" width={520} destroyOnClose>
        <div className="todo-association-dialog">
          <label>
            <span>项目</span>
            <select value={draftProjectId} onChange={(event) => { setDraftProjectId(event.target.value); setDraftSessionId('') }} aria-label="选择项目">
              <option value="">选择项目</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            <span>会话</span>
            <select value={draftSessionId} onChange={(event) => setDraftSessionId(event.target.value)} aria-label="选择会话" disabled={!draftProjectId || sessionLoadState === 'loading'}>
              <option value="">{sessionLoadState === 'loading' ? '正在读取会话…' : sessionLoadState === 'error' ? '会话读取失败，请重新选择项目' : !draftProjectId ? '请先选择项目' : todoSessions.length ? '选择会话' : '这个项目没有历史会话'}</option>
              {todoSessions.map((session) => <option value={session.sessionId} key={session.sessionId}>{session.title || '未命名会话'}</option>)}
            </select>
          </label>
          <div className="todo-association-actions">
            <button type="button" className="todo-association-clear" onClick={clearAssociation}>清除关联</button>
            <div><button type="button" className="todo-association-cancel" onClick={() => setAssociationDialogOpen(false)}>取消</button><button type="button" className="todo-association-confirm" onClick={applyAssociation} disabled={!draftSessionId}>关联会话</button></div>
          </div>
        </div>
      </Modal>

      <Modal open={Boolean(editingTodoId)} onCancel={() => setEditingTodoId(undefined)} footer={null} title="编辑待办" width={520} destroyOnClose>
        <div className="todo-edit-dialog">
          <label>
            <span>待办内容</span>
            <input value={editTodoTitle} onChange={(event) => setEditTodoTitle(event.target.value)} aria-label="待办内容" maxLength={100} autoFocus />
          </label>
          <label className="todo-edit-completion">
            <input type="checkbox" checked={editTodoDone} onChange={(event) => setEditTodoDone(event.target.checked)} />
            <span>标记为已完成</span>
          </label>
          <label>
            <span>项目</span>
            <select value={editProjectId} onChange={(event) => { setEditProjectId(event.target.value); setEditSessionId(''); setEditSessionTitle('') }} aria-label="编辑项目">
              <option value="">不关联项目</option>
              {projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}
            </select>
          </label>
          <label>
            <span>会话</span>
            <select value={editSessionId} onChange={(event) => { const session = editSessions.find((item) => item.sessionId === event.target.value); setEditSessionId(event.target.value); setEditSessionTitle(session?.title || '') }} aria-label="编辑会话" disabled={!editProjectId || editSessionLoadState === 'loading'}>
              {editSessionId && !editSessions.some((session) => session.sessionId === editSessionId) && <option value={editSessionId}>{editSessionTitle || '已关联会话'}</option>}
              <option value="">{editSessionLoadState === 'loading' ? '正在读取会话…' : editSessionLoadState === 'error' ? '会话读取失败，请重新选择项目' : !editProjectId ? '请先选择项目' : editSessions.length ? '不关联会话' : '这个项目没有历史会话'}</option>
              {editSessions.map((session) => <option value={session.sessionId} key={session.sessionId}>{session.title || '未命名会话'}</option>)}
            </select>
          </label>
          <div className="todo-association-actions">
            <button type="button" className="todo-association-clear" onClick={clearEditAssociation}>清除关联</button>
            <div><button type="button" className="todo-association-cancel" onClick={() => setEditingTodoId(undefined)}>取消</button><button type="button" className="todo-association-confirm" onClick={saveTodoEdit} disabled={!editTodoTitle.trim()}>保存更改</button></div>
          </div>
        </div>
      </Modal>
    </main>
  )
}
