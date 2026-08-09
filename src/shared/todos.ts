/** Column ids are stable user-defined identifiers; titles can be renamed independently. */
export type TodoColumnId = string

export interface TodoItem {
  id: string
  title: string
  done: boolean
  important: boolean
  columnId: TodoColumnId
  position: number
  projectId?: string
  sessionId?: string
  sessionTitle?: string
  createdAt: string
  updatedAt: string
}

export interface CreateTodoInput {
  title: string
  important?: boolean
  columnId?: TodoColumnId
  position?: number
  projectId?: string
  sessionId?: string
  sessionTitle?: string
}

export interface UpdateTodoInput {
  title?: string
  done?: boolean
  important?: boolean
  columnId?: TodoColumnId
  position?: number
  projectId?: string
  sessionId?: string
  sessionTitle?: string
}

export interface ReorderTodoInput {
  id: string
  columnId: TodoColumnId
  position: number
}

export interface TodoListInput {
  status?: 'active' | 'done' | 'all'
  important?: boolean
  projectId?: string
  query?: string
  limit?: number
  offset?: number
}

export interface TodoListResult {
  total: number
  count: number
  offset: number
  hasMore: boolean
  nextOffset?: number
  items: TodoItem[]
}

export interface TodosApi {
  list: (input?: TodoListInput) => Promise<TodoListResult>
  get: (id: string) => Promise<TodoItem>
  create: (input: CreateTodoInput) => Promise<TodoItem>
  update: (id: string, input: UpdateTodoInput) => Promise<TodoItem>
  reorder: (items: ReorderTodoInput[]) => Promise<TodoItem[]>
  setDone: (id: string, done: boolean) => Promise<TodoItem>
  delete: (id: string) => Promise<void>
}
