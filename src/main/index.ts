import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type { CreateAutomationInput, UpdateAutomationInput } from '../shared/automations'
import type { CreateTodoInput, ReorderTodoInput, UpdateTodoInput } from '../shared/todos'
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
import { automationsFilePath, getAutomationStore } from './services/automation-store'
import { AutomationScheduler, executeScheduledAutomation } from './services/automation-scheduler'
import { getTodoStore, todosFilePath } from './services/todo-store'
import {
  getLastDirectoryPath,
  getPreferredPermissionModeId,
  setLastDirectoryPath,
  setPreferredPermissionModeId
} from './services/preferences-store'

let mainWindow: BrowserWindow | undefined
const acpBridge = new AcpBridge({
  getPreferredModeId: getPreferredPermissionModeId,
  setPreferredModeId: setPreferredPermissionModeId
})
let automationScheduler: AutomationScheduler | undefined
let httpMcpProcess: ChildProcess | undefined

function startHttpMcpServer(): void {
  const entry = join(__dirname, '../mcp/mcp/automations-server.js')
  httpMcpProcess = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      KOALA_MCP_TRANSPORT: 'http',
      KOALA_AUTOMATIONS_FILE: automationsFilePath(),
      KOALA_TODOS_FILE: todosFilePath()
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  httpMcpProcess.stderr?.on('data', (chunk: Buffer) => console.error(`[koala-mcp] ${chunk.toString().trim()}`))
  httpMcpProcess.on('error', (error) => console.error('无法启动本地 Koala MCP 服务：', error))
  httpMcpProcess.on('exit', () => { httpMcpProcess = undefined })
}

function stopHttpMcpServer(): void {
  httpMcpProcess?.kill()
  httpMcpProcess = undefined
}

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
  const defaultPath = await getLastDirectoryPath()
  const options: Electron.OpenDialogOptions = {
    title: '选择项目文件夹',
    buttonLabel: '选择',
    defaultPath,
    properties: ['openDirectory', 'createDirectory']
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return null
  const selectedPath = result.filePaths[0]
  await setLastDirectoryPath(selectedPath)
  return selectedPath
}

app.whenReady().then(() => {
  ipcMain.handle('acp:get-state', () => acpBridge.getState())
  ipcMain.handle('acp:connect', (_, cwd: string) => acpBridge.connect(cwd))
  ipcMain.handle('acp:prompt', (_, request) => acpBridge.prompt(request))
  ipcMain.handle('acp:stop', () => acpBridge.stop())
  ipcMain.handle('acp:set-mode', (_, modeId: string) => acpBridge.setMode(modeId))
  ipcMain.handle('acp:set-model', (_, modelId: string) => acpBridge.setModel(modelId))
  ipcMain.handle('acp:list-sessions', async (_event, cwd: string) => {
    // 会话索引查询使用短连接，避免侧栏读取其他项目时切断当前聊天。
    const listingBridge = new AcpBridge()
    try {
      return await listingBridge.listSessions(cwd)
    } finally {
      listingBridge.dispose()
    }
  })
  ipcMain.handle('acp:load-session', (_event, sessionId: string, cwd: string) => acpBridge.loadSession(sessionId, cwd))
  ipcMain.handle('acp:create-session', (_event, cwd: string) => acpBridge.createSession(cwd))

  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:create', (_event, input: CreateProjectInput) => createProject(input))
  ipcMain.handle('projects:update', (_event, id: string, input: UpdateProjectInput) => updateProject(id, input))
  ipcMain.handle('projects:delete', (_event, id: string) => deleteProject(id))
  ipcMain.handle('projects:reorder', (_event, orderedIds: string[]) => reorderProjects(orderedIds))
  ipcMain.handle('projects:pick-directory', () => pickDirectory())

  ipcMain.handle('automations:list', (_event, input) => getAutomationStore().list(input))
  ipcMain.handle('automations:get', (_event, id: string) => getAutomationStore().get(id))
  ipcMain.handle('automations:create', (_event, input: CreateAutomationInput) => getAutomationStore().create(input))
  ipcMain.handle('automations:update', (_event, id: string, input: UpdateAutomationInput) => getAutomationStore().update(id, input))
  ipcMain.handle('automations:set-enabled', (_event, id: string, enabled: boolean) => getAutomationStore().setEnabled(id, enabled))
  ipcMain.handle('automations:run-test', (_event, id: string) => getAutomationStore().runTest(id))
  ipcMain.handle('automations:delete', (_event, id: string) => getAutomationStore().delete(id))

  ipcMain.handle('todos:list', (_event, input) => getTodoStore().list(input))
  ipcMain.handle('todos:get', (_event, id: string) => getTodoStore().get(id))
  ipcMain.handle('todos:create', (_event, input: CreateTodoInput) => getTodoStore().create(input))
  ipcMain.handle('todos:update', (_event, id: string, input: UpdateTodoInput) => getTodoStore().update(id, input))
  ipcMain.handle('todos:reorder', (_event, items: ReorderTodoInput[]) => getTodoStore().reorder(items))
  ipcMain.handle('todos:set-done', (_event, id: string, done: boolean) => getTodoStore().setDone(id, done))
  ipcMain.handle('todos:delete', (_event, id: string) => getTodoStore().delete(id))

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

  automationScheduler = new AutomationScheduler(getAutomationStore(), executeScheduledAutomation)
  automationScheduler.start()
  startHttpMcpServer()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  automationScheduler?.stop()
  acpBridge.dispose()
  stopHttpMcpServer()
})
