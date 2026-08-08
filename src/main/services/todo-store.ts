import { app } from 'electron'
import { join } from 'node:path'
import { TodoStore } from '../../shared/todo-store'

let store: TodoStore | undefined

export function todosFilePath(): string {
  return join(app.getPath('userData'), 'todos.json')
}

export function getTodoStore(): TodoStore {
  store ??= new TodoStore(todosFilePath())
  return store
}
