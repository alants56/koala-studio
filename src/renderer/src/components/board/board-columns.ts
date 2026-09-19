import type { TodoColumnId, TodoItem } from '../../../../shared/todos'

/** 看板的一列（待办类型）。id 稳定、标题可改名。 */
export interface BoardColumn {
  id: TodoColumnId
  title: string
}

/** 拖拽落点：某列中某条待办之前，未指定 beforeId 表示落到列尾。 */
export interface DropTarget {
  columnId: TodoColumnId
  beforeId?: string
}

export type TodoBoard = Record<string, TodoItem[]>

const COLUMNS_STORAGE_PREFIX = 'koala-studio:todo-board-columns-v1'

export const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: 'backlog', title: '待处理' },
  { id: 'in-progress', title: '进行中' },
  { id: 'completed', title: '已完成' }
]

function storageKey(projectId: string): string {
  return `${COLUMNS_STORAGE_PREFIX}:${projectId}`
}

/** 解析 localStorage 里的列配置，去重、去空，坏数据回退默认列。 */
export function parseBoardColumns(raw: unknown): BoardColumn[] {
  if (Array.isArray(raw)) {
    const seen = new Set<string>()
    const columns = raw.flatMap((value) => {
      // localStorage 里的数据可能被手改坏，null / 字符串等非对象项一律丢弃。
      if (!value || typeof value !== 'object') return []
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
}

export function readBoardColumns(projectId: string): BoardColumn[] {
  const key = storageKey(projectId)
  try {
    return parseBoardColumns(JSON.parse(window.localStorage.getItem(key) || 'null'))
  } catch {
    window.localStorage.removeItem(key)
    return DEFAULT_COLUMNS
  }
}

export function writeBoardColumns(projectId: string, columns: BoardColumn[]): void {
  window.localStorage.setItem(storageKey(projectId), JSON.stringify(columns))
}

export function createColumnId(): string {
  return `type-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 按列分组并按 position 排序。
 *
 * Agent 通过 MCP 建待办时用的是默认 columnId（backlog），在改过列名的项目里可能对不上任何一列。
 * 这类待办归入第一列，否则会分到一个永远不渲染的桶里，在看板上直接消失。
 */
export function boardFromTodos(todos: TodoItem[], columns: BoardColumn[]): TodoBoard {
  const board: TodoBoard = Object.fromEntries(columns.map((column) => [column.id, []]))
  const fallbackId = columns[0]?.id
  todos.forEach((todo) => {
    const columnId = board[todo.columnId] ? todo.columnId : fallbackId
    if (columnId) board[columnId].push(todo)
  })
  Object.values(board).forEach((columnTodos) => {
    columnTodos.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
  })
  return board
}

/**
 * 把待办移动到目标列的目标位置，并为所有列重新编号 position。
 *
 * 顺带把归入兜底列的待办写回真实列 id：调用方提交的排序数据本身就会覆盖 columnId。
 */
export function moveTodoInBoard(
  todos: TodoItem[],
  columns: BoardColumn[],
  todoId: string,
  targetColumnId: TodoColumnId,
  beforeId?: string
): TodoItem[] {
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
