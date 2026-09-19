import { contextBridge, ipcRenderer } from 'electron'
import type { AcpApi, AgentAdapterId } from '../shared/acp'
import type { ProjectsApi } from '../shared/projects'
import type { ConversationsApi } from '../shared/conversations'
import type { TodosApi } from '../shared/todos'
import type { AttachmentsApi } from '../shared/attachments'
import type { FileActionsApi } from '../shared/files'
import type { GitApi } from '../shared/git'
import type { WorkspaceApi } from '../shared/workspace'

const acp: AcpApi = {
  getSessionStates: () => ipcRenderer.invoke('acp:get-session-states'),
  getState: (target) => ipcRenderer.invoke('acp:get-state', target),
  connect: (cwd) => ipcRenderer.invoke('acp:connect', cwd),
  prompt: (request) => ipcRenderer.invoke('acp:prompt', request),
  removeQueuedPrompt: (id, target) => ipcRenderer.invoke('acp:remove-queued-prompt', id, target),
  steerQueuedPrompt: (id, target) => ipcRenderer.invoke('acp:steer-queued-prompt', id, target),
  stop: (target) => ipcRenderer.invoke('acp:stop', target),
  setMode: (modeId, target) => ipcRenderer.invoke('acp:set-mode', modeId, target),
  setModel: (modelId, target) => ipcRenderer.invoke('acp:set-model', modelId, target),
  setEffort: (effortId, target) => ipcRenderer.invoke('acp:set-effort', effortId, target),
  setAgent: (agentId: AgentAdapterId) => ipcRenderer.invoke('acp:set-agent', agentId),
  listSessions: (cwd) => ipcRenderer.invoke('acp:list-sessions', cwd),
  renameSession: (cwd, sessionId, title) => ipcRenderer.invoke('acp:rename-session', cwd, sessionId, title),
  setSessionArchived: (cwd, sessionId, archived, title) => ipcRenderer.invoke('acp:set-session-archived', cwd, sessionId, archived, title),
  listArchivedSessions: () => ipcRenderer.invoke('acp:list-archived-sessions'),
  deleteSession: (cwd, sessionId) => ipcRenderer.invoke('acp:delete-session', cwd, sessionId),
  loadSession: (sessionId, cwd, agent) => ipcRenderer.invoke('acp:load-session', sessionId, cwd, agent),
  createSession: (cwd, agent) => ipcRenderer.invoke('acp:create-session', cwd, agent),
  respondPermission: (optionId, target) => ipcRenderer.invoke('acp:respond-permission', optionId, target),
  onState: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
    ipcRenderer.on('acp:state', handler)
    return () => ipcRenderer.removeListener('acp:state', handler)
  },
  onMessage: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, message: Parameters<typeof listener>[0]) => listener(message)
    ipcRenderer.on('acp:message', handler)
    return () => ipcRenderer.removeListener('acp:message', handler)
  }
}

const projects: ProjectsApi = {
  list: () => ipcRenderer.invoke('projects:list'),
  create: (input) => ipcRenderer.invoke('projects:create', input),
  update: (id, input) => ipcRenderer.invoke('projects:update', id, input),
  delete: (id) => ipcRenderer.invoke('projects:delete', id),
  reorder: (orderedIds) => ipcRenderer.invoke('projects:reorder', orderedIds),
  pickDirectory: () => ipcRenderer.invoke('projects:pick-directory')
}

const conversations: ConversationsApi = {
  list: () => ipcRenderer.invoke('conversations:list'),
  create: () => ipcRenderer.invoke('conversations:create'),
  update: (id, input) => ipcRenderer.invoke('conversations:update', id, input),
  touch: (id) => ipcRenderer.invoke('conversations:touch', id),
  setArchived: (id, archived) => ipcRenderer.invoke('conversations:set-archived', id, archived),
  delete: (id) => ipcRenderer.invoke('conversations:delete', id)
}

const todos: TodosApi = {
  list: (input) => ipcRenderer.invoke('todos:list', input),
  get: (id) => ipcRenderer.invoke('todos:get', id),
  create: (input) => ipcRenderer.invoke('todos:create', input),
  update: (id, input) => ipcRenderer.invoke('todos:update', id, input),
  reorder: (items) => ipcRenderer.invoke('todos:reorder', items),
  setDone: (id, done) => ipcRenderer.invoke('todos:set-done', id, done),
  delete: (id) => ipcRenderer.invoke('todos:delete', id)
}

const attachments: AttachmentsApi = {
  importFiles: (files) => ipcRenderer.invoke('attachments:import', files),
  listOpenWithApps: (storageKey) => ipcRenderer.invoke('attachments:list-open-with-apps', storageKey),
  open: (storageKey, applicationPath) => ipcRenderer.invoke('attachments:open', storageKey, applicationPath),
  reveal: (storageKey) => ipcRenderer.invoke('attachments:reveal', storageKey)
}

const files: FileActionsApi = {
  listOpenWithApps: (cwd, path) => ipcRenderer.invoke('files:list-open-with-apps', cwd, path),
  open: (cwd, path, applicationPath) => ipcRenderer.invoke('files:open', cwd, path, applicationPath),
  reveal: (cwd, path) => ipcRenderer.invoke('files:reveal', cwd, path)
}

const workspace: WorkspaceApi = {
  getDefaultWorkspace: () => ipcRenderer.invoke('workspace:get-default')
}

const git: GitApi = {
  status: (cwd) => ipcRenderer.invoke('git:status', cwd),
  diff: (cwd) => ipcRenderer.invoke('git:diff', cwd),
  changes: (cwd) => ipcRenderer.invoke('git:changes', cwd),
  fileDiff: (cwd, path) => ipcRenderer.invoke('git:file-diff', cwd, path),
  checkout: (cwd, branch) => ipcRenderer.invoke('git:checkout', cwd, branch),
  createBranch: (cwd, branch) => ipcRenderer.invoke('git:create-branch', cwd, branch),
  commit: (cwd, message, options) => ipcRenderer.invoke('git:commit', cwd, message, options),
  generateCommitMessage: (cwd) => ipcRenderer.invoke('git:generate-commit-message', cwd)
}

contextBridge.exposeInMainWorld('acp', acp)
contextBridge.exposeInMainWorld('projects', projects)
contextBridge.exposeInMainWorld('conversations', conversations)
contextBridge.exposeInMainWorld('todos', todos)
contextBridge.exposeInMainWorld('attachments', attachments)
contextBridge.exposeInMainWorld('files', files)
contextBridge.exposeInMainWorld('workspace', workspace)
contextBridge.exposeInMainWorld('git', git)
