import { contextBridge, ipcRenderer } from 'electron'
import type { AcpApi } from '../shared/acp'
import type { ProjectsApi } from '../shared/projects'

const acp: AcpApi = {
  getState: () => ipcRenderer.invoke('acp:get-state'),
  connect: (cwd) => ipcRenderer.invoke('acp:connect', cwd),
  prompt: (request) => ipcRenderer.invoke('acp:prompt', request),
  stop: () => ipcRenderer.invoke('acp:stop'),
  setMode: (modeId) => ipcRenderer.invoke('acp:set-mode', modeId),
  listSessions: (cwd) => ipcRenderer.invoke('acp:list-sessions', cwd),
  loadSession: (sessionId, cwd) => ipcRenderer.invoke('acp:load-session', sessionId, cwd),
  createSession: (cwd) => ipcRenderer.invoke('acp:create-session', cwd),
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
  pickDirectory: () => ipcRenderer.invoke('projects:pick-directory')
}

contextBridge.exposeInMainWorld('acp', acp)
contextBridge.exposeInMainWorld('projects', projects)
