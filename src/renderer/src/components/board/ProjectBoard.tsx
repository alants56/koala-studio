import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent, type ReactElement } from 'react'
import {
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
  EditOutlined,
  FlagFilled,
  FlagOutlined,
  MessageOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined
} from '@ant-design/icons'
import { App, Button, Dropdown, Modal, Switch } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import type { AcpSessionInfo } from '@shared/acp'
import type { TodoColumnId, TodoItem } from '@shared/todos'
import type { Project } from '@/models'
import { useProjects } from '@/state/ProjectsContext'
import { DEFAULT_COLUMNS, boardFromTodos, createColumnId, moveTodoInBoard, readBoardColumns, writeBoardColumns, type BoardColumn, type DropTarget } from './board-columns'

interface ProjectBoardProps {
  project: Project
  /** 点了一条尚未挂载会话的待办：由项目页换一代会话，首条消息发出后自动挂载。 */
  onLaunchTodo: (todo: TodoItem) => void
}

/**
 * 项目看板：该项目的待办按类型分列，可拖拽流转。
 *
 * 待办即会话入口——点未挂载的待办会带着挂载意图跳到新会话（见 ProjectChatPage 的 todo/n 参数），
 * 开始对话后自动关联；已有会话的待办则直接跳到那个会话。
 */
export function ProjectBoard({ project, onLaunchTodo }: ProjectBoardProps): ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const { defaultWorkspace } = useProjects()
  const { modal } = App.useApp()
  const hasLoadedRef = useRef(false)
  const cancelColumnEditRef = useRef(false)
  // 拖拽结束紧接着触发的 click 不应跳转（真实拖拽后 Chrome 通常会吞掉 click，这里兜底）。
  const suppressClickRef = useRef(false)
  const [todos, setTodos] = useState<TodoItem[]>([])
  const [unassigned, setUnassigned] = useState<TodoItem[]>([])
  const [columns, setColumns] = useState<BoardColumn[]>(() => readBoardColumns(project.id))
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [boardError, setBoardError] = useState('')
  /** 默认收起已完成的待办，避免看板被划线卡片占满。 */
  const [showCompleted, setShowCompleted] = useState(false)
  const [claimPending, setClaimPending] = useState(false)
  const [draggingTodoId, setDraggingTodoId] = useState<string>()
  const [dropTarget, setDropTarget] = useState<DropTarget>()
  const [editingColumnId, setEditingColumnId] = useState<TodoColumnId>()
  const [columnTitleDraft, setColumnTitleDraft] = useState('')
  const [isAddingColumn, setIsAddingColumn] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')

  // 待办弹窗：editingTodoId 为空表示新建。项目固定为本看板的项目，因此不需要「项目」选择。
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTodoId, setEditingTodoId] = useState<string>()
  const [formTitle, setFormTitle] = useState('')
  const [formColumnId, setFormColumnId] = useState<TodoColumnId>(() => columns[0]?.id ?? DEFAULT_COLUMNS[0].id)
  const [formSessionId, setFormSessionId] = useState('')
  const [formSessionTitle, setFormSessionTitle] = useState('')
  const [pending, setPending] = useState(false)
  const [dialogSessions, setDialogSessions] = useState<AcpSessionInfo[]>([])
  const [sessionLoadState, setSessionLoadState] = useState<'idle' | 'loading' | 'error'>('idle')

  const editing = editingTodoId !== undefined

  const loadTodos = useCallback(async (): Promise<void> => {
    setLoadState('loading')
    setBoardError('')
    try {
      const [scoped, all] = await Promise.all([
        window.todos.list({ projectId: project.id, limit: 100 }),
        window.todos.list({ limit: 100 })
      ])
      setTodos(scoped.items)
      // 历史上面向全局看板建的待办、以及 Agent 经 MCP 建的未指定项目的待办，都不属于任何看板。
      setUnassigned(all.items.filter((todo) => !todo.projectId))
      setLoadState('ready')
    } catch {
      setLoadState('error')
      setBoardError('待办读取失败，请重试')
    }
  }, [project.id])

  useEffect(() => {
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true
    void loadTodos()
  }, [loadTodos])

  // 会话列表按需读取：每次 listSessions 都会起一个短命 ACP 连接并 spawn agent 进程，不能在看板挂载时就读。
  useEffect(() => {
    if (!dialogOpen) {
      setDialogSessions([])
      setSessionLoadState('idle')
      return
    }
    let cancelled = false
    setSessionLoadState('loading')
    void window.acp.listSessions(project.path ?? defaultWorkspace)
      .then((sessions) => { if (!cancelled) { setDialogSessions(sessions); setSessionLoadState('idle') } })
      .catch(() => { if (!cancelled) setSessionLoadState('error') })
    return () => { cancelled = true }
  }, [defaultWorkspace, dialogOpen, project.path])

  const board = useMemo(() => boardFromTodos(todos, columns), [columns, todos])
  // 默认不显示已完成的待办。过滤只作用于渲染：排序提交和拖拽仍走完整列表，
  // 否则被隐藏的待办会丢掉 position，重新打开开关时顺序会乱。
  const visibleBoard = useMemo(
    () => (showCompleted ? board : boardFromTodos(todos.filter((todo) => !todo.done), columns)),
    [board, columns, showCompleted, todos]
  )
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
        void window.todos.list({ projectId: project.id, limit: 100 }).then(({ items }) => setTodos(items))
      })
  }

  const openTodoCreator = (columnId: TodoColumnId): void => {
    setEditingTodoId(undefined)
    setFormTitle('')
    setFormColumnId(columnId)
    setFormSessionId('')
    setFormSessionTitle('')
    setDialogOpen(true)
  }

  const openTodoEditor = (todo: TodoItem): void => {
    setEditingTodoId(todo.id)
    setFormTitle(todo.title)
    setFormColumnId(todo.columnId)
    setFormSessionId(todo.sessionId || '')
    setFormSessionTitle(todo.sessionTitle || '')
    setDialogOpen(true)
  }

  const closeTodoDialog = (): void => {
    if (pending) return
    setDialogOpen(false)
    setEditingTodoId(undefined)
  }

  /** 主动挂载：把待办指向本项目中某个已有会话（在弹窗里选择）。 */
  const saveTodo = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const title = formTitle.trim()
    if (!title || pending) return
    const current = editingTodoId ? todos.find((todo) => todo.id === editingTodoId) : undefined
    if (editingTodoId && !current) return
    const selected = dialogSessions.find((session) => session.sessionId === formSessionId)
    const sessionTitle = selected?.title || (current?.sessionId === formSessionId ? current.sessionTitle : undefined)
    const position = current && current.columnId === formColumnId ? current.position : (board[formColumnId]?.length ?? 0)

    setPending(true)
    setBoardError('')
    const request = current
      ? window.todos.update(current.id, { title, columnId: formColumnId, position, sessionId: formSessionId || undefined, sessionTitle })
      : window.todos.create({ title, columnId: formColumnId, position, projectId: project.id, sessionId: formSessionId || undefined, sessionTitle })

    void request
      .then((todo) => {
        if (!current) {
          setTodos((items) => {
            const currentColumn = boardFromTodos(items, columns)[todo.columnId] ?? []
            return moveTodoInBoard([...items, todo], columns, todo.id, todo.columnId, currentColumn[0]?.id)
          })
        } else {
          const base = todos.map((item) => item.id === todo.id ? todo : item)
          if (current.columnId === formColumnId) setTodos(base)
          else persistBoard(moveTodoInBoard(base, columns, todo.id, formColumnId))
        }
        setDialogOpen(false)
        setEditingTodoId(undefined)
      })
      .catch(() => setBoardError(editingTodoId ? '待办保存失败，请重试' : '待办创建失败，请重试'))
      .finally(() => setPending(false))
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

  /** 把未归属任何项目的待办批量收进本项目。 */
  const claimUnassigned = (): void => {
    if (!unassigned.length) return
    modal.confirm({
      title: '归入本项目',
      content: `将 ${unassigned.length} 条未归属的待办归入「${project.name}」。`,
      okText: '归入',
      cancelText: '取消',
      onOk: () => {
        setClaimPending(true)
        return Promise.all(unassigned.map((todo) => window.todos.update(todo.id, { projectId: project.id })))
          .then(() => { setBoardError(''); void loadTodos() })
          .catch(() => {
            setBoardError('归入失败，请重试')
            throw new Error('Claiming unassigned todos failed')
          })
          .finally(() => setClaimPending(false))
      }
    })
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
      writeBoardColumns(project.id, next)
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
    writeBoardColumns(project.id, next)
    setFormColumnId(column.id)
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
        writeBoardColumns(project.id, next)
        if (formColumnId === column.id) setFormColumnId(next[0].id)
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

  const handleDragEnd = (): void => {
    setDraggingTodoId(undefined)
    setDropTarget(undefined)
    suppressClickRef.current = true
    setTimeout(() => { suppressClickRef.current = false }, 0)
  }

  const handleDrop = (event: DragEvent, columnId: TodoColumnId, beforeId?: string): void => {
    event.preventDefault()
    event.stopPropagation()
    const todoId = draggingTodoId || event.dataTransfer.getData('text/plain')
    if (todoId && todoId !== beforeId) persistBoard(moveTodoInBoard(todos, columns, todoId, columnId, beforeId))
    setDraggingTodoId(undefined)
    setDropTarget(undefined)
  }

  const basePath = `/projects/${encodeURIComponent(project.id)}`

  /** 待办即会话入口：已挂载的直接进那个会话，没挂载的交给项目页起一代新会话。 */
  const launchTodo = (todo: TodoItem): void => {
    if (!todo.sessionId) {
      onLaunchTodo(todo)
      return
    }
    void navigate(`${basePath}?session=${encodeURIComponent(todo.sessionId)}&view=chat`)
  }

  /** 只摘掉 view，其余参数原样保留：丢掉 session 会切走当前会话。 */
  const openChat = (): void => {
    const params = new URLSearchParams(location.search)
    params.delete('view')
    void navigate({ pathname: basePath, search: params.toString() })
  }

  return (
    <main className="kanban-page">
      <header className="kanban-header">
        <div className="kanban-heading">
          <span className="workbench-kicker">TO-DO BOARD</span>
          <div className="kanban-title-row">
            <h1>{project.name}</h1>
            <span>{todos.length - completed} 项进行中</span>
            <span>{completed} 项已完成</span>
          </div>
        </div>
        <div className="kanban-header-actions">
          <span className="kanban-completed-toggle">
            <Switch
              size="small"
              checked={showCompleted}
              onChange={setShowCompleted}
              aria-label="显示已完成的待办"
            />
            <span>显示已完成</span>
          </span>
          <Button type="text" icon={<MessageOutlined />} onClick={openChat}>返回对话</Button>
        </div>
        {boardError && <div className="kanban-error" role="status">{boardError}</div>}
      </header>

      {unassigned.length > 0 && (
        <div className="kanban-unassigned" role="status">
          <span>{unassigned.length} 条待办未归属任何项目</span>
          <button type="button" onClick={claimUnassigned} disabled={claimPending}>归入本项目</button>
        </div>
      )}

      {loadState === 'loading' ? (
        <div className="kanban-board kanban-board-loading" aria-label="正在读取待办">
          {columns.map((column) => <section className="kanban-column" key={column.id}><div className="kanban-skeleton-title" /><div className="kanban-skeleton-card" /><div className="kanban-skeleton-card kanban-skeleton-card-short" /></section>)}
        </div>
      ) : loadState === 'error' ? (
        <div className="kanban-load-error"><span>无法读取待办</span><button type="button" onClick={() => void loadTodos()}><ReloadOutlined />重新加载</button></div>
      ) : (
        <div className="kanban-board">
          {columns.map((column) => {
            const columnTodos = visibleBoard[column.id] ?? []
            const hiddenCount = (board[column.id]?.length ?? 0) - columnTodos.length
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
                  {columnTodos.length === 0 && <div className="kanban-column-empty">{hiddenCount > 0 ? '已完成项已收起' : '暂无待办'}</div>}
                  {columnTodos.map((todo) => {
                    const dropBefore = dropTarget?.columnId === column.id && dropTarget.beforeId === todo.id
                    return (
                      <article className={`kanban-card ${todo.done ? 'kanban-card-done' : ''} ${draggingTodoId === todo.id ? 'kanban-card-dragging' : ''} ${dropBefore ? 'kanban-card-drop-before' : ''}`} key={todo.id} draggable onDragStart={(event) => handleDragStart(event, todo.id)} onDragEnd={handleDragEnd} onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'move'; if (draggingTodoId !== todo.id) setDropTarget({ columnId: column.id, beforeId: todo.id }) }} onDrop={(event) => handleDrop(event, column.id, todo.id)}>
                        <div className="kanban-card-main">
                          <button type="button" className="todo-check" onClick={() => toggleDone(todo)} aria-label={todo.done ? `恢复「${todo.title}」` : `完成「${todo.title}」`} title={todo.done ? '恢复待办' : '完成待办'}>{todo.done && <CheckOutlined />}</button>
                          <div className="todo-copy">
                            <button
                              type="button"
                              className="todo-item-label todo-item-open"
                              onClick={() => { if (!suppressClickRef.current) launchTodo(todo) }}
                              title={todo.sessionId ? `进入会话「${todo.sessionTitle || '未命名会话'}」` : `为「${todo.title}」开启新对话`}
                            >
                              {todo.title}
                            </button>
                            {todo.sessionId && (
                              <button type="button" className="todo-project-link" onClick={() => launchTodo(todo)} title={`进入会话「${todo.sessionTitle || '未命名会话'}」`}>
                                <MessageOutlined />{project.name} · {todo.sessionTitle || '会话'}
                              </button>
                            )}
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

      <Modal open={dialogOpen} onCancel={closeTodoDialog} footer={null} title={editing ? '编辑待办' : '创建待办'} width={520} destroyOnHidden mask={{ closable: !pending }} closable={!pending}>
        <form className="todo-edit-dialog" onSubmit={saveTodo}>
          <label><span>待办内容</span><input value={formTitle} onChange={(event) => setFormTitle(event.target.value)} aria-label="待办内容" placeholder="输入要完成的事项" maxLength={100} autoFocus /></label>
          <label><span>待办类型</span><select value={formColumnId} onChange={(event) => setFormColumnId(event.target.value)} aria-label="待办类型">{columns.map((column) => <option value={column.id} key={column.id}>{column.title}</option>)}</select></label>
          <label><span>挂载会话</span><select value={formSessionId} onChange={(event) => { const value = event.target.value; setFormSessionId(value); setFormSessionTitle(dialogSessions.find((session) => session.sessionId === value)?.title || '') }} aria-label="挂载会话" disabled={sessionLoadState === 'loading'}>{formSessionId && !dialogSessions.some((session) => session.sessionId === formSessionId) && <option value={formSessionId}>{formSessionTitle || '已关联会话'}</option>}<option value="">{sessionLoadState === 'loading' ? '正在读取会话…' : sessionLoadState === 'error' ? '会话读取失败' : dialogSessions.length ? '不挂载会话' : '这个项目没有历史会话'}</option>{dialogSessions.map((session) => <option value={session.sessionId} key={session.sessionId}>{session.title || '未命名会话'}</option>)}</select></label>
          <div className="todo-association-actions"><button type="button" className="todo-association-clear" onClick={() => { setFormSessionId(''); setFormSessionTitle('') }} disabled={!formSessionId || pending}>清除挂载</button><div><button type="button" className="todo-association-cancel" onClick={closeTodoDialog} disabled={pending}>取消</button><button type="submit" className="todo-association-confirm" disabled={!formTitle.trim() || pending}>{pending ? (editing ? '正在保存…' : '正在创建…') : editing ? '保存更改' : '创建待办'}</button></div></div>
        </form>
      </Modal>
    </main>
  )
}
