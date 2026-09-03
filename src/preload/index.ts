import { contextBridge, ipcRenderer } from 'electron'
import type { AcpApi, AgentAdapterId } from '../shared/acp'
import type { ProjectsApi } from '../shared/projects'
import type { ClaudeApi } from '../shared/claude'
import type { AutomationsApi } from '../shared/automations'
import type { TodosApi } from '../shared/todos'
import type { AttachmentsApi } from '../shared/attachments'
import type { WorkspaceApi } from '../shared/workspace'

const acp: AcpApi = {
  getState: () => ipcRenderer.invoke('acp:get-state'),
  connect: (cwd) => ipcRenderer.invoke('acp:connect', cwd),
  prompt: (request) => ipcRenderer.invoke('acp:prompt', request),
  removeQueuedPrompt: (id) => ipcRenderer.invoke('acp:remove-queued-prompt', id),
  steerQueuedPrompt: (id) => ipcRenderer.invoke('acp:steer-queued-prompt', id),
  stop: () => ipcRenderer.invoke('acp:stop'),
  setMode: (modeId) => ipcRenderer.invoke('acp:set-mode', modeId),
  setModel: (modelId) => ipcRenderer.invoke('acp:set-model', modelId),
  setEffort: (effortId) => ipcRenderer.invoke('acp:set-effort', effortId),
  setAgent: (agentId: AgentAdapterId) => ipcRenderer.invoke('acp:set-agent', agentId),
  listSessions: (cwd) => ipcRenderer.invoke('acp:list-sessions', cwd),
  loadSession: (sessionId, cwd) => ipcRenderer.invoke('acp:load-session', sessionId, cwd),
  createSession: (cwd) => ipcRenderer.invoke('acp:create-session', cwd),
  respondPermission: (optionId) => ipcRenderer.invoke('acp:respond-permission', optionId),
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

const claude: ClaudeApi = {
  list: (agent) => ipcRenderer.invoke('claude:list', agent),
  readSkill: (agent, id) => ipcRenderer.invoke('claude:read-skill', agent, id),
  saveSkill: (agent, input) => ipcRenderer.invoke('claude:save-skill', agent, input),
  removeSkill: (agent, id) => ipcRenderer.invoke('claude:remove-skill', agent, id),
  saveMcp: (agent, input) => ipcRenderer.invoke('claude:save-mcp', agent, input),
  removeMcp: (agent, name, scope, projectPath) => ipcRenderer.invoke('claude:remove-mcp', agent, name, scope, projectPath),
  pluginAction: (agent, action, id) => ipcRenderer.invoke('claude:plugin-action', agent, action, id),
  reveal: (agent, path) => ipcRenderer.invoke('claude:reveal', agent, path)
}

const automations: AutomationsApi = {
  list: (input) => ipcRenderer.invoke('automations:list', input),
  get: (id) => ipcRenderer.invoke('automations:get', id),
  create: (input) => ipcRenderer.invoke('automations:create', input),
  update: (id, input) => ipcRenderer.invoke('automations:update', id, input),
  setEnabled: (id, enabled) => ipcRenderer.invoke('automations:set-enabled', id, enabled),
  runTest: (id) => ipcRenderer.invoke('automations:run-test', id),
  delete: (id) => ipcRenderer.invoke('automations:delete', id)
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
  open: (storageKey) => ipcRenderer.invoke('attachments:open', storageKey)
}

const workspace: WorkspaceApi = {
  getDefaultWorkspace: () => ipcRenderer.invoke('workspace:get-default')
}

contextBridge.exposeInMainWorld('acp', acp)
contextBridge.exposeInMainWorld('projects', projects)
contextBridge.exposeInMainWorld('claude', claude)
contextBridge.exposeInMainWorld('automations', automations)
contextBridge.exposeInMainWorld('todos', todos)
contextBridge.exposeInMainWorld('attachments', attachments)
contextBridge.exposeInMainWorld('workspace', workspace)
