import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { CreateProjectInput, UpdateProjectInput } from '../shared/projects'
import { AcpBridge } from './services/acp-bridge'
import {
  listClaudeResources,
  readClaudeSkill,
  removeClaudeMcp,
  removeClaudeSkill,
  revealClaudePath,
  runClaudePluginAction,
  saveClaudeMcp,
  saveClaudeSkill
} from './services/claude-resources'
import { createProject, deleteProject, listProjects, reorderProjects, updateProject } from './services/project-store'

let mainWindow: BrowserWindow | undefined
const acpBridge = new AcpBridge()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 720,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type === 'keyDown' && input.meta && input.shift && input.key.toLowerCase() === 'o') {
      event.preventDefault()
      mainWindow?.webContents.openDevTools({ mode: 'detach', activate: true })
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 打开系统目录选择对话框：支持选择已有文件夹，也支持新建文件夹（macOS createDirectory）。 */
async function pickDirectory(): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: '选择项目文件夹',
    buttonLabel: '选择',
    properties: ['openDirectory', 'createDirectory']
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

app.whenReady().then(() => {
  ipcMain.handle('acp:get-state', () => acpBridge.getState())
  ipcMain.handle('acp:connect', (_, cwd: string) => acpBridge.connect(cwd))
  ipcMain.handle('acp:prompt', (_, request) => acpBridge.prompt(request))
  ipcMain.handle('acp:stop', () => acpBridge.stop())
  ipcMain.handle('acp:set-mode', (_, modeId: string) => acpBridge.setMode(modeId))
  ipcMain.handle('acp:list-sessions', (_event, cwd: string) => acpBridge.listSessions(cwd))
  ipcMain.handle('acp:load-session', (_event, sessionId: string, cwd: string) => acpBridge.loadSession(sessionId, cwd))
  ipcMain.handle('acp:create-session', (_event, cwd: string) => acpBridge.createSession(cwd))

  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:create', (_event, input: CreateProjectInput) => createProject(input))
  ipcMain.handle('projects:update', (_event, id: string, input: UpdateProjectInput) => updateProject(id, input))
  ipcMain.handle('projects:delete', (_event, id: string) => deleteProject(id))
  ipcMain.handle('projects:reorder', (_event, orderedIds: string[]) => reorderProjects(orderedIds))
  ipcMain.handle('projects:pick-directory', () => pickDirectory())

  ipcMain.handle('claude:list', () => listClaudeResources())
  ipcMain.handle('claude:read-skill', (_event, id: string) => readClaudeSkill(id))
  ipcMain.handle('claude:save-skill', (_event, input) => saveClaudeSkill(input))
  ipcMain.handle('claude:remove-skill', (_event, id: string) => removeClaudeSkill(id))
  ipcMain.handle('claude:save-mcp', (_event, input) => saveClaudeMcp(input))
  ipcMain.handle('claude:remove-mcp', (_event, name: string, scope, projectPath?: string) => removeClaudeMcp(name, scope, projectPath))
  ipcMain.handle('claude:plugin-action', (_event, action, id: string) => runClaudePluginAction(action, id))
  ipcMain.handle('claude:reveal', (_event, path: string) => revealClaudePath(path))


  acpBridge.on('state', (state) => mainWindow?.webContents.send('acp:state', state))
  acpBridge.on('message', (message) => mainWindow?.webContents.send('acp:message', message))

  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => acpBridge.dispose())
