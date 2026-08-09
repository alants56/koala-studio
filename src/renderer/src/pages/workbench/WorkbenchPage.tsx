import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import { CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined, FlagFilled, FlagOutlined, MessageOutlined, MoreOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { App, Button, Dropdown, Modal } from 'antd'
import { useNavigate } from 'react-router-dom'
import type { AcpSessionInfo } from '@shared/acp'
import type { TodoColumnId, TodoItem } from '@shared/todos'
import { useProjects } from '@/state/ProjectsContext'
import { WORKSPACE_PATH } from '@/utils/constants'

interface BoardColumn {
  id: TodoColumnId
  title: string
}

interface DropTarget {
  columnId: TodoColumnId
  beforeId?: string
}

type TodoBoard = Record<string, TodoItem[]>

const BOARD_COLUMNS_STORAGE_KEY = 'koala-studio:todo-board-columns-v1'
const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: 'backlog', title: '待处理' },
  { id: 'in-progress', title: '进行中' },
  { id: 'completed', title: '已完成' }
]

function boardFromTodos(todos: TodoItem[], columns: BoardColumn[]): TodoBoard {
  const board: TodoBoard = Object.fromEntries(columns.map((column) => [column.id, []]))
  todos.forEach((todo) => (board[todo.columnId] ??= []).push(todo))
  Object.values(board).forEach((columnTodos) => {
    columnTodos.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
  })
  return board
}

function moveTodoInBoard(todos: TodoItem[], columns: BoardColumn[], todoId: string, targetColumnId: TodoColumnId, beforeId?: string): TodoItem[] {
  const dragged = todos.find((todo) => todo.id === todoId)
  if (!dragged) return todos
  const board = boardFromTodos(todos, columns)
  columns.forEach(({ id }) => {
    board[id] = board[id].filter((todo) => todo.id !== todoId)
  })
  const target = board[targetColumnId]
  if (!target) return todos
  const targetIndex = beforeId ? target.findIndex((todo) => todo.id === beforeId) : target.length
  target.splice(targetIndex < 0 ? target.length : targetIndex, 0, dragged)

  const placement = new Map<string, { columnId: TodoColumnId; position: number }>()
  columns.forEach(({ id }) => {
    board[id].forEach((todo, position) => placement.set(todo.id, { columnId: id, position }))
  })
  return todos.map((todo) => {
    const next = placement.get(todo.id)
    return next ? { ...todo, ...next } : todo
  })
}

function readBoardColumns(): BoardColumn[] {
  try {
    const stored: unknown = JSON.parse(window.localStorage.getItem(BOARD_COLUMNS_STORAGE_KEY) || 'null')
    if (Array.isArray(stored)) {
      const seen = new Set<string>()
      const columns = stored.flatMap((value) => {
        const candidate = value as Partial<BoardColumn>
        const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
        const title = typeof candidate.title === 'string' ? candidate.title.trim() : ''
        if (!id || !title || seen.has(id)) return []
        seen.add(id)
        return [{ id, title }]
      })
      if (columns.length) return columns
    }
    return DEFAULT_COLUMNS
  } catch {
    window.localStorage.removeItem(BOARD_COLUMNS_STORAGE_KEY)
    return DEFAULT_COLUMNS
  }
}

function writeBoardColumns(columns: BoardColumn[]): void {
  window.localStorage.setItem(BOARD_COLUMNS_STORAGE_KEY, JSON.stringify(columns))
}

function createColumnId(): string {
  return `type-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 工作台：支持排序、跨列流转和项目关联的待办看板。 */
export function WorkbenchPage(): ReactElement {
  const navigate = useNavigate()
  const { projects } = useProjects()
  const { modal } = App.useApp()
  const hasLoadedRef = useRef(false)
  const cancelColumnEditRef = useRef(false)
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [columns, setColumns] = useState<BoardColumn[]>(readBoardColumns)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [boardError, setBoardError] = useState('')
  const [todoTitle, setTodoTitle] = useState('')
  const [todoColumnId, setTodoColumnId] = useState<TodoColumnId>('backlog')
  const [todoProjectId, setTodoProjectId] = useState('')
  const [todoSessionId, setTodoSessionId] = useState('')
  const [todoSessionTitle, setTodoSessionTitle] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createPending, setCreatePending] = useState(false)
  const [todoSessions, setTodoSessions] = useState<AcpSessionInfo[]>([])
  const [sessionLoadState, setSessionLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [editingTodoId, setEditingTodoId] = useState<string>()
  const [editTodoTitle, setEditTodoTitle] = useState('')
  const [editColumnId, setEditColumnId] = useState<TodoColumnId>('backlog')
  const [editProjectId, setEditProjectId] = useState('')
  const [editSessionId, setEditSessionId] = useState('')
  const [editSessionTitle, setEditSessionTitle] = useState('')
  const [editSessions, setEditSessions] = useState<AcpSessionInfo[]>([])
  const [editSessionLoadState, setEditSessionLoadState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [editingColumnId, setEditingColumnId] = useState<TodoColumnId>()
  const [columnTitleDraft, setColumnTitleDraft] = useState('')
  const [isAddingColumn, setIsAddingColumn] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')
  const [draggingTodoId, setDraggingTodoId] = useState<string>()
  const [dropTarget, setDropTarget] = useState<DropTarget>()

  const loadTodos = useCallback(async (): Promise<void> => {
    setLoadState('loading')
    setBoardError('')
    try {
      const result = await window.todos.list({ limit: 100 })
      setTodos(result.items)
      setLoadState('ready')
    } catch {
      setLoadState('error')
      setBoardError('待办读取失败，请重试')
    }
  }, [])

  useEffect(() => {
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true
    void loadTodos()
  }, [loadTodos])

  useEffect(() => {
    const project = projects.find((item) => item.id === todoProjectId)
    setTodoSessions([])
    if (!project) { setSessionLoadState('idle'); return }
    let cancelled = false
    setSessionLoadState('loading')
    void window.acp.listSessions(project.path ?? WORKSPACE_PATH)
      .then((sessions) => { if (!cancelled) { setTodoSessions(sessions); setSessionLoadState('idle') } })
      .catch(() => { if (!cancelled) setSessionLoadState('error') })
    return () => { cancelled = true }
  }, [projects, todoProjectId])

  useEffect(() => {
    const project = projects.find((item) => item.id === editProjectId)
    setEditSessions([])
    if (!project) { setEditSessionLoadState('idle'); return }
    let cancelled = false
    setEditSessionLoadState('loading')
    void window.acp.listSessions(project.path ?? WORKSPACE_PATH)
      .then((sessions) => { if (!cancelled) { setEditSessions(sessions); setEditSessionLoadState('idle') } })
      .catch(() => { if (!cancelled) setEditSessionLoadState('error') })
    return () => { cancelled = true }
  }, [editProjectId, projects])

  const board = useMemo(() => boardFromTodos(todos, columns), [columns, todos])
  const completed = todos.filter((todo) => todo.done).length

  const persistBoard = (nextTodos: TodoItem[]): void => {
    setTodos(nextTodos)
    setBoardError('')
    const nextBoard = boardFromTodos(nextTodos, columns)
    const placements = columns.flatMap(({ id }) => nextBoard[id].map((todo) => ({ id: todo.id, columnId: id, position: todo.position })))
    void window.todos.reorder(placements)
      .then((updated) => setTodos((current) => {
        const updatedById = new Map(updated.map((todo) => [todo.id, todo]))
        return current.map((todo) => updatedById.get(todo.id) ?? todo)
      }))
      .catch(() => {
        setBoardError('排序保存失败，已恢复上次保存的顺序')
        void window.todos.list({ limit: 100 }).then(({ items }) => setTodos(items))
      })
  }

  const moveTodo = (todoId: string, columnId: TodoColumnId, beforeId?: string): void => {
    persistBoard(moveTodoInBoard(todos, columns, todoId, columnId, beforeId))
  }

  const addTodo = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const title = todoTitle.trim()
    if (!title || createPending) return
    setCreatePending(true)
    void window.todos.create({ title, columnId: todoColumnId, position: 0, projectId: todoProjectId || undefined, sessionId: todoSessionId || undefined, sessionTitle: todoSessionTitle || undefined })
      .then((todo) => {
        setTodos((items) => {
          const currentColumn = boardFromTodos(items, columns)[todo.columnId] ?? []
          return moveTodoInBoard([...items, todo], columns, todo.id, todo.columnId, currentColumn[0]?.id)
        })
        setBoardError('')
        setCreateDialogOpen(false)
        setTodoTitle('')
        setTodoProjectId('')
        setTodoSessionId('')
        setTodoSessionTitle('')
      })
      .catch(() => setBoardError('待办创建失败，请重试'))
      .finally(() => setCreatePending(false))
  }

  const openTodoCreator = (columnId: TodoColumnId): void => {
    setEditingTodoId(undefined)
    setTodoColumnId(columnId)
    setTodoTitle('')
    setTodoProjectId('')
    setTodoSessionId('')
    setTodoSessionTitle('')
    setCreateDialogOpen(true)
  }

  const toggleImportant = (todo: TodoItem): void => {
    void window.todos.update(todo.id, { important: !todo.important })
      .then((updated) => setTodos((items) => items.map((item) => item.id === updated.id ? updated : item)))
      .catch(() => setBoardError('重点状态保存失败，请重试'))
  }

  const toggleDone = (todo: TodoItem): void => {
    void window.todos.setDone(todo.id, !todo.done)
      .then((updated) => setTodos((items) => items.map((item) => item.id === updated.id ? updated : item)))
      .catch(() => setBoardError('完成状态保存失败，请重试'))
  }

  const removeTodo = (todo: TodoItem): void => {
    modal.confirm({
      title: '删除待办',
      content: `确定删除「${todo.title}」吗？此操作无法恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => window.todos.delete(todo.id)
        .then(() => setTodos((items) => items.filter((item) => item.id !== todo.id)))
        .catch(() => {
          setBoardError('待办删除失败，请重试')
          throw new Error('Todo deletion failed')
        })
    })
  }

  const clearCreateAssociation = (): void => {
    setTodoProjectId('')
    setTodoSessionId('')
    setTodoSessionTitle('')
  }

  const openTodoEditor = (todo: TodoItem): void => {
    setCreateDialogOpen(false)
    setEditingTodoId(todo.id)
    setEditTodoTitle(todo.title)
    setEditColumnId(todo.columnId)
    setEditProjectId(todo.projectId || '')
    setEditSessionId(todo.sessionId || '')
    setEditSessionTitle(todo.sessionTitle || '')
  }

  const saveTodoEdit = (): void => {
    const title = editTodoTitle.trim()
    const current = todos.find((todo) => todo.id === editingTodoId)
    if (!title || !current) return
    const selectedSession = editSessions.find((session) => session.sessionId === editSessionId)
    const position = current.columnId === editColumnId ? current.position : (board[editColumnId]?.length ?? 0)
    void window.todos.update(current.id, {
      title,
      columnId: editColumnId,
      position,
      projectId: editProjectId || undefined,
      sessionId: editSessionId || undefined,
      sessionTitle: selectedSession?.title || (current.sessionId === editSessionId ? current.sessionTitle : undefined)
    }).then((updated) => {
      const base = todos.map((todo) => todo.id === updated.id ? updated : todo)
      if (current.columnId === editColumnId) setTodos(base)
      else persistBoard(moveTodoInBoard(base, columns, updated.id, editColumnId))
      setEditingTodoId(undefined)
    }).catch(() => setBoardError('待办保存失败，请重试'))
  }

  const clearEditAssociation = (): void => {
    setEditProjectId('')
    setEditSessionId('')
    setEditSessionTitle('')
  }

  const startColumnEdit = (column: BoardColumn): void => {
    cancelColumnEditRef.current = false
    setEditingColumnId(column.id)
    setColumnTitleDraft(column.title)
  }

  const saveColumnTitle = (): void => {
    if (!editingColumnId) return
    if (cancelColumnEditRef.current) {
      cancelColumnEditRef.current = false
      setEditingColumnId(undefined)
      return
    }
    const title = columnTitleDraft.trim()
    if (title) {
      if (columns.some((column) => column.id !== editingColumnId && column.title === title)) {
        setBoardError('待办类型名称不能重复')
        setEditingColumnId(undefined)
        return
      }
      const next = columns.map((column) => column.id === editingColumnId ? { ...column, title } : column)
      setColumns(next)
      writeBoardColumns(next)
      setBoardError('')
    }
    setEditingColumnId(undefined)
  }

  const addColumn = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const title = newColumnTitle.trim()
    if (!title) return
    if (columns.some((column) => column.title === title)) {
      setBoardError('待办类型名称不能重复')
      return
    }
    const column: BoardColumn = { id: createColumnId(), title }
    const next = [...columns, column]
    setColumns(next)
    writeBoardColumns(next)
    setTodoColumnId(column.id)
    setNewColumnTitle('')
    setIsAddingColumn(false)
    setBoardError('')
  }

  const removeColumn = (column: BoardColumn): void => {
    if ((board[column.id]?.length ?? 0) > 0) {
      setBoardError(`请先移走「${column.title}」中的待办`)
      return
    }
    if (columns.length === 1) {
      setBoardError('至少需要保留一个待办类型')
      return
    }
    modal.confirm({
      title: '删除待办类型',
      content: `确定删除「${column.title}」吗？此操作无法恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        const next = columns.filter((item) => item.id !== column.id)
        setColumns(next)
        writeBoardColumns(next)
        if (todoColumnId === column.id) setTodoColumnId(next[0].id)
        if (editColumnId === column.id) setEditColumnId(next[0].id)
        setBoardError('')
      }
    })
  }

  const handleColumnTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') {
      cancelColumnEditRef.current = true
      event.currentTarget.blur()
    }
  }

  const handleDragStart = (event: DragEvent<HTMLElement>, todoId: string): void => {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', todoId)
    setDraggingTodoId(todoId)
  }

  const handleDrop = (event: DragEvent, columnId: TodoColumnId, beforeId?: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const todoId = draggingTodoId || event.dataTransfer.getData('text/plain')
    if (todoId && todoId !== beforeId) moveTodo(todoId, columnId, beforeId)
    setDraggingTodoId(undefined)
    setDropTarget(undefined)
  }

  const todoDialogMode: 'create' | 'edit' | undefined = createDialogOpen ? 'create' : editingTodoId ? 'edit' : undefined
  const dialogTitle = todoDialogMode === 'create' ? todoTitle : editTodoTitle
  const dialogColumnId = todoDialogMode === 'create' ? todoColumnId : editColumnId
  const dialogProjectId = todoDialogMode === 'create' ? todoProjectId : editProjectId
  const dialogSessionId = todoDialogMode === 'create' ? todoSessionId : editSessionId
  const dialogSessionTitle = todoDialogMode === 'create' ? todoSessionTitle : editSessionTitle
  const dialogSessions = todoDialogMode === 'create' ? todoSessions : editSessions
  const dialogSessionLoadState = todoDialogMode === 'create' ? sessionLoadState : editSessionLoadState
  const dialogPending = todoDialogMode === 'create' && createPending

  const closeTodoDialog = (): void => {
    if (dialogPending) return
    setCreateDialogOpen(false)
    setEditingTodoId(undefined)
  }

  const setDialogTitle = (value: string): void => {
    if (todoDialogMode === 'create') setTodoTitle(value)
    else setEditTodoTitle(value)
  }

  const setDialogColumnId = (value: TodoColumnId): void => {
    if (todoDialogMode === 'create') setTodoColumnId(value)
    else setEditColumnId(value)
  }

  const setDialogProjectId = (value: string): void => {
    if (todoDialogMode === 'create') {
      setTodoProjectId(value)
      setTodoSessionId('')
      setTodoSessionTitle('')
    } else {
      setEditProjectId(value)
      setEditSessionId('')
      setEditSessionTitle('')
    }
  }

  const setDialogSessionId = (value: string): void => {
    const session = dialogSessions.find((item) => item.sessionId === value)
    if (todoDialogMode === 'create') {
      setTodoSessionId(value)
      setTodoSessionTitle(session?.title || '')
    } else {
      setEditSessionId(value)
      setEditSessionTitle(session?.title || '')
    }
  }

  const clearTodoDialogAssociation = (): void => {
    if (todoDialogMode === 'create') clearCreateAssociation()
    else clearEditAssociation()
  }

  const submitTodoDialog = (event: FormEvent<HTMLFormElement>): void => {
    if (todoDialogMode === 'create') addTodo(event)
    else {
      event.preventDefault()
      saveTodoEdit()
    }
  }

  return (
    <main className="workbench-page kanban-page">
      <header className="kanban-header">
        <div className="kanban-heading">
          <span className="workbench-kicker">TO-DO BOARD</span>
          <div className="kanban-title-row">
            <h1>工作看板</h1>
            <span>{todos.length - completed} 项进行中</span>
            <span>{completed} 项已完成</span>
          </div>
        </div>
        {boardError && <div className="kanban-error" role="status">{boardError}</div>}
      </header>

      {loadState === 'loading' ? (
        <div className="kanban-board kanban-board-loading" aria-label="正在读取待办">
          {DEFAULT_COLUMNS.map((column) => <section className="kanban-column" key={column.id}><div className="kanban-skeleton-title" /><div className="kanban-skeleton-card" /><div className="kanban-skeleton-card kanban-skeleton-card-short" /></section>)}
        </div>
      ) : loadState === 'error' ? (
        <div className="kanban-load-error"><span>无法读取待办</span><button type="button" onClick={() => void loadTodos()}><ReloadOutlined />重新加载</button></div>
      ) : (
        <div className="kanban-board">
          {columns.map((column) => {
            const columnTodos = board[column.id] ?? []
            const isColumnDropTarget = dropTarget?.columnId === column.id
            return (
              <section className={`kanban-column ${isColumnDropTarget ? 'kanban-column-drag-over' : ''}`} key={column.id} aria-labelledby={`column-${column.id}`} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget({ columnId: column.id }) }} onDrop={(event) => handleDrop(event, column.id)}>
                <header className="kanban-column-header">
                  <div className="kanban-column-title-wrap">
                    {editingColumnId === column.id ? (
                      <input className="kanban-column-title-input" value={columnTitleDraft} onChange={(event) => setColumnTitleDraft(event.target.value)} onBlur={saveColumnTitle} onKeyDown={handleColumnTitleKeyDown} aria-label={`重命名「${column.title}」列`} maxLength={20} autoFocus />
                    ) : (
                      <h2 id={`column-${column.id}`}>{column.title}</h2>
                    )}
                    <span className="kanban-column-count">{columnTodos.length}</span>
                  </div>
                  {editingColumnId !== column.id && (
                    <div className="kanban-column-actions">
                      <Dropdown
                        menu={{
                          items: [
                            { key: 'edit', icon: <EditOutlined />, label: '编辑' },
                            { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true, disabled: columnTodos.length > 0 || columns.length === 1, title: columnTodos.length > 0 ? '类型中有待办，不能删除' : columns.length === 1 ? '至少保留一个类型' : undefined }
                          ],
                          onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation()
                            if (key === 'edit') startColumnEdit(column)
                            if (key === 'delete') removeColumn(column)
                          }
                        }}
                        trigger={['click']}
                      >
                        <Button className="kanban-column-more" type="text" size="small" icon={<MoreOutlined />} aria-label={`待办类型「${column.title}」的更多操作`} onClick={(event) => event.stopPropagation()} />
                      </Dropdown>
                    </div>
                  )}
                </header>
                <button type="button" className="kanban-column-add-todo" onClick={() => openTodoCreator(column.id)} title={`在「${column.title}」中添加待办`}><PlusOutlined /><span>添加待办</span></button>
                <div className="kanban-column-body">
                  {columnTodos.length === 0 && <div className="kanban-column-empty">暂无待办</div>}
                  {columnTodos.map((todo) => {
                    const project = todo.projectId ? projects.find((item) => item.id === todo.projectId) : undefined
                    const sessionLink = project && todo.sessionId ? `${project.name} · ${todo.sessionTitle || '会话'}` : undefined
                    const dropBefore = dropTarget?.columnId === column.id && dropTarget.beforeId === todo.id
                    return (
                      <article className={`kanban-card ${todo.done ? 'kanban-card-done' : ''} ${draggingTodoId === todo.id ? 'kanban-card-dragging' : ''} ${dropBefore ? 'kanban-card-drop-before' : ''}`} key={todo.id} draggable onDragStart={(event) => handleDragStart(event, todo.id)} onDragEnd={() => { setDraggingTodoId(undefined); setDropTarget(undefined) }} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; if (draggingTodoId !== todo.id) setDropTarget({ columnId: column.id, beforeId: todo.id }) }} onDrop={(event) => handleDrop(event, column.id, todo.id)}>
                        <div className="kanban-card-main">
                          <button type="button" className="todo-check" onClick={() => toggleDone(todo)} aria-label={todo.done ? `恢复「${todo.title}」` : `完成「${todo.title}」`} title={todo.done ? '恢复待办' : '完成待办'}>{todo.done && <CheckOutlined />}</button>
                          <div className="todo-copy">
                            <span className="todo-item-label">{todo.title}</span>
                            {project && todo.sessionId && sessionLink ? <button type="button" className="todo-project-link" onClick={() => void navigate(`/projects/${project.id}?session=${encodeURIComponent(todo.sessionId!)}`)} title={`进入会话「${todo.sessionTitle || '未命名会话'}」`}><MessageOutlined />{sessionLink}</button> : project && <button type="button" className="todo-project-link" onClick={() => void navigate(`/projects/${project.id}`)} title={`进入「${project.name}」对话`}><MessageOutlined />{project.name}</button>}
                          </div>
                          <Dropdown
                            menu={{
                              items: [
                                { key: 'edit', icon: <EditOutlined />, label: '编辑' },
                                { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true }
                              ],
                              onClick: ({ key, domEvent }) => {
                                domEvent.stopPropagation()
                                if (key === 'edit') openTodoEditor(todo)
                                if (key === 'delete') removeTodo(todo)
                              }
                            }}
                            trigger={['click']}
                          >
                            <Button className="kanban-card-more" type="text" size="small" icon={<MoreOutlined />} aria-label={`待办「${todo.title}」的更多操作`} onClick={(event) => event.stopPropagation()} />
                          </Dropdown>
                        </div>
                        <div className="kanban-card-actions">
                          <button type="button" className={`todo-important ${todo.important ? 'todo-important-active' : ''}`} onClick={() => toggleImportant(todo)} aria-label={todo.important ? `取消标记「${todo.title}」为重点` : `标记「${todo.title}」为重点`} title={todo.important ? '取消重点' : '标记重点'}>{todo.important ? <FlagFilled /> : <FlagOutlined />}</button>
                        </div>
                      </article>
                    )
                  })}
                  {isColumnDropTarget && !dropTarget?.beforeId && <div className="kanban-drop-tail" aria-hidden="true" />}
                </div>
              </section>
            )
          })}
          <section className={`kanban-column-create ${isAddingColumn ? 'kanban-column-create-active' : ''}`} aria-label="创建待办类型">
            {isAddingColumn ? (
              <form onSubmit={addColumn}>
                <input value={newColumnTitle} onChange={(event) => setNewColumnTitle(event.target.value)} placeholder="类型名称" aria-label="待办类型名称" maxLength={20} autoFocus />
                <div>
                  <button type="submit" className="workspace-icon-button" disabled={!newColumnTitle.trim()} aria-label="创建类型" title="创建类型"><CheckOutlined /></button>
                  <button type="button" className="workspace-icon-button" onClick={() => { setIsAddingColumn(false); setNewColumnTitle('') }} aria-label="取消创建类型" title="取消"><CloseOutlined /></button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={() => setIsAddingColumn(true)}><PlusOutlined /><span>新建类型</span></button>
            )}
          </section>
        </div>
      )}

      <Modal open={Boolean(todoDialogMode)} onCancel={closeTodoDialog} footer={null} title={todoDialogMode === 'create' ? '创建待办' : '编辑待办'} width={520} destroyOnHidden mask={{ closable: !dialogPending }} closable={!dialogPending}>
        <form className="todo-edit-dialog" onSubmit={submitTodoDialog}>
          <label><span>待办内容</span><input value={dialogTitle} onChange={(event) => setDialogTitle(event.target.value)} aria-label="待办内容" placeholder="输入要完成的事项" maxLength={100} autoFocus /></label>
          <label><span>待办类型</span><select value={dialogColumnId} onChange={(event) => setDialogColumnId(event.target.value)} aria-label="待办类型">{columns.map((column) => <option value={column.id} key={column.id}>{column.title}</option>)}</select></label>
          <label><span>项目</span><select value={dialogProjectId} onChange={(event) => setDialogProjectId(event.target.value)} aria-label="选择项目"><option value="">不关联项目</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>
          <label><span>会话</span><select value={dialogSessionId} onChange={(event) => setDialogSessionId(event.target.value)} aria-label="选择会话" disabled={!dialogProjectId || dialogSessionLoadState === 'loading'}>{dialogSessionId && !dialogSessions.some((session) => session.sessionId === dialogSessionId) && <option value={dialogSessionId}>{dialogSessionTitle || '已关联会话'}</option>}<option value="">{dialogSessionLoadState === 'loading' ? '正在读取会话…' : dialogSessionLoadState === 'error' ? '会话读取失败，请重新选择项目' : !dialogProjectId ? '请先选择项目' : dialogSessions.length ? '不关联会话' : '这个项目没有历史会话'}</option>{dialogSessions.map((session) => <option value={session.sessionId} key={session.sessionId}>{session.title || '未命名会话'}</option>)}</select></label>
          <div className="todo-association-actions"><button type="button" className="todo-association-clear" onClick={clearTodoDialogAssociation} disabled={!dialogProjectId || dialogPending}>清除关联</button><div><button type="button" className="todo-association-cancel" onClick={closeTodoDialog} disabled={dialogPending}>取消</button><button type="submit" className="todo-association-confirm" disabled={!dialogTitle.trim() || dialogPending}>{dialogPending ? '正在创建…' : todoDialogMode === 'create' ? '创建待办' : '保存更改'}</button></div></div>
        </form>
      </Modal>
    </main>
  )
}
