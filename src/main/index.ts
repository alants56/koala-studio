import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, shell } from 'electron'
import { basename, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import type { AttachmentImportInput } from '../shared/attachments'
import type { AgentAdapterId } from '../shared/acp'
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
import { getAutomationStore } from './services/automation-store'
import { AutomationScheduler, executeScheduledAutomation } from './services/automation-scheduler'
import { getTodoStore } from './services/todo-store'
import {
  getLastDirectoryPath,
  getPreferredPermissionModeId,
  setLastDirectoryPath,
  setPreferredPermissionModeId,
  getPreferredModelId,
  setPreferredModelId,
  getPreferredEffortId,
  setPreferredEffortId,
  getPreferredAgentId,
  setPreferredAgentId
} from './services/preferences-store'
import { attachmentFilePath, importAttachments } from './services/attachment-store'
import { getQueuedPromptStore } from './services/queued-prompt-store'

const execFileAsync = promisify(execFile)
const openWithAppsCache = new Map<string, Promise<OpenWithApp[]>>()

interface OpenWithApp { name: string; path: string; icon?: string }

async function applicationIcon(appPath: string, preferredIconFile?: string): Promise<string | undefined> {
  const resourcesPath = join(appPath, 'Contents', 'Resources')
  try {
    const files = await readdir(resourcesPath)
    const preferredName = preferredIconFile?.toLowerCase().endsWith('.icns') ? preferredIconFile : preferredIconFile ? `${preferredIconFile}.icns` : undefined
    const iconFile = files.find((file) => file === preferredName) ?? files.find((file) => file.toLowerCase().endsWith('.icns'))
    if (iconFile) {
      const image = nativeImage.createFromPath(join(resourcesPath, iconFile))
      if (!image.isEmpty()) return image.resize({ width: 32, height: 32 }).toDataURL()
    }
  } catch {}
  return app.getFileIcon(appPath, { size: 'small' }).then((image) => image.toDataURL()).catch(() => undefined)
}

async function listOpenWithApps(filePath: string): Promise<OpenWithApp[]> {
  const extension = basename(filePath).split('.').pop()?.toLowerCase() || ''
  const cached = openWithAppsCache.get(extension)
  if (cached) return cached
  const request = discoverOpenWithApps(filePath, extension)
  openWithAppsCache.set(extension, request)
  return request
}

async function discoverOpenWithApps(filePath: string, extension: string): Promise<OpenWithApp[]> {
  if (process.platform !== 'darwin') return []
  const roots = ['/Applications', '/System/Applications', join(process.env.HOME || '', 'Applications')].filter(Boolean)
  let appPaths: string[] = []
  try {
    const result = await execFileAsync('find', [...roots, '-maxdepth', '2', '-type', 'd', '-name', '*.app', '-prune', '-print'], { maxBuffer: 1024 * 1024 })
    appPaths = result.stdout.split('\n').map((item) => item.trim()).filter(Boolean)
  } catch {
    return []
  }
  const apps: OpenWithApp[] = []
  for (const appPath of appPaths.slice(0, 200)) {
    try {
      const plist = await execFileAsync('plutil', ['-convert', 'json', '-o', '-', `${appPath}/Contents/Info.plist`], { maxBuffer: 256 * 1024 })
      const info = JSON.parse(plist.stdout) as { CFBundleDisplayName?: string; CFBundleName?: string; CFBundleIconFile?: string; CFBundleDocumentTypes?: Array<{ CFBundleTypeExtensions?: string[] }> }
      const supported = info.CFBundleDocumentTypes?.some((type) => type.CFBundleTypeExtensions?.some((item) => item === '*' || item.toLowerCase() === extension))
      if (!supported) continue
      const name = info.CFBundleDisplayName || info.CFBundleName || basename(appPath, '.app')
      const icon = await applicationIcon(appPath, info.CFBundleIconFile)
      apps.push({ name, path: appPath, icon })
    } catch {}
  }
  return apps.sort((left, right) => left.name.localeCompare(right.name))
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'koala-asset', privileges: { secure: true, standard: true, supportFetchAPI: true, stream: true } }
])

let mainWindow: BrowserWindow | undefined
const acpBridge = new AcpBridge({
  getPreferredModeId: getPreferredPermissionModeId,
  setPreferredModeId: setPreferredPermissionModeId,
  getPreferredModelId: getPreferredModelId,
  setPreferredModelId: setPreferredModelId,
  getPreferredEffortId: getPreferredEffortId,
  setPreferredEffortId: setPreferredEffortId,
  getPreferredAgentId: getPreferredAgentId,
  setPreferredAgentId: setPreferredAgentId,
  queuedPromptStore: getQueuedPromptStore()
})
let automationScheduler: AutomationScheduler | undefined

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

function parseResourceAgent(value: string): AgentAdapterId {
  if (value !== 'claude' && value !== 'pi') throw new Error('不支持的 Agent 类型。')
  return value
}

/** 项目未指定文件夹时的默认工作区：开发模式用应用所在目录，打包后用用户主目录。 */
function getDefaultWorkspace(): string {
  return app.isPackaged ? app.getPath('home') : app.getAppPath()
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
  protocol.handle('koala-asset', (request) => {
    try {
      const storageKey = decodeURIComponent(new URL(request.url).pathname.slice(1))
      return net.fetch(pathToFileURL(attachmentFilePath(storageKey)).toString())
    } catch {
      return new Response('Attachment not found', { status: 404 })
    }
  })

  ipcMain.handle('acp:get-state', async () => {
    await acpBridge.getCurrentAgent()
    return acpBridge.getState()
  })
  ipcMain.handle('acp:connect', (_, cwd: string) => acpBridge.connect(cwd))
  ipcMain.handle('acp:prompt', (_, request) => acpBridge.prompt(request))
  ipcMain.handle('acp:remove-queued-prompt', (_, id: string) => acpBridge.removeQueuedPrompt(id))
  ipcMain.handle('acp:steer-queued-prompt', (_, id: string) => acpBridge.steerQueuedPrompt(id))
  ipcMain.handle('acp:stop', () => acpBridge.stop())
  ipcMain.handle('acp:set-mode', (_, modeId: string) => acpBridge.setMode(modeId))
  ipcMain.handle('acp:set-model', (_, modelId: string) => acpBridge.setModel(modelId))
  ipcMain.handle('acp:set-effort', (_, effortId: string) => acpBridge.setEffort(effortId))
  ipcMain.handle('acp:set-agent', (_, agentId: string) => acpBridge.setAgent(agentId as 'claude' | 'pi'))
  ipcMain.handle('acp:list-sessions', async (_event, cwd: string) => {
    // 会话索引查询使用短连接，用主 bridge 当前的 agent 类型，避免侧栏读取其他项目时切断当前聊天。
    const agentId = await acpBridge.getCurrentAgent()
    const listingBridge = new AcpBridge({ initialAgentId: agentId })
    try {
      const [sessions, queueCounts] = await Promise.all([
        listingBridge.listSessions(cwd),
        getQueuedPromptStore().countBySession(agentId, cwd)
      ])
      return sessions.map((session) => ({ ...session, queueDepth: queueCounts.get(session.sessionId) ?? 0 }))
    } finally {
      listingBridge.dispose()
    }
  })
  ipcMain.handle('acp:load-session', (_event, sessionId: string, cwd: string) => acpBridge.loadSession(sessionId, cwd))
  ipcMain.handle('acp:create-session', (_event, cwd: string) => acpBridge.createSession(cwd))
  ipcMain.handle('acp:respond-permission', (_event, optionId: string) => acpBridge.respondPermission(optionId))

  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:create', (_event, input: CreateProjectInput) => createProject(input))
  ipcMain.handle('projects:update', (_event, id: string, input: UpdateProjectInput) => updateProject(id, input))
  ipcMain.handle('projects:delete', (_event, id: string) => deleteProject(id))
  ipcMain.handle('projects:reorder', (_event, orderedIds: string[]) => reorderProjects(orderedIds))
  ipcMain.handle('projects:pick-directory', () => pickDirectory())
  ipcMain.handle('workspace:get-default', () => getDefaultWorkspace())

  ipcMain.handle('attachments:import', (_event, files: AttachmentImportInput[]) => importAttachments(files))
  ipcMain.handle('attachments:list-open-with-apps', (_event, storageKey: string) => listOpenWithApps(attachmentFilePath(storageKey)))
  ipcMain.handle('attachments:open', async (_event, storageKey: string, applicationPath?: string) => {
    const filePath = attachmentFilePath(storageKey)
    if (applicationPath) {
      await execFileAsync('open', ['-a', applicationPath, filePath])
      return
    }
    const error = await shell.openPath(filePath)
    if (error) throw new Error(error)
  })
  ipcMain.handle('attachments:reveal', (_event, storageKey: string) => {
    shell.showItemInFolder(attachmentFilePath(storageKey))
  })
  ipcMain.handle('files:list-open-with-apps', (_event, cwd: string, path: string) => listOpenWithApps(resolve(cwd, path)))
  ipcMain.handle('files:open', async (_event, cwd: string, path: string, applicationPath?: string) => {
    const filePath = resolve(cwd, path)
    if (applicationPath) {
      await execFileAsync('open', ['-a', applicationPath, filePath])
      return
    }
    const error = await shell.openPath(filePath)
    if (error) throw new Error(error)
  })
  ipcMain.handle('files:reveal', (_event, cwd: string, path: string) => {
    shell.showItemInFolder(resolve(cwd, path))
  })

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

  ipcMain.handle('claude:list', (_event, agent: string) => listClaudeResources(parseResourceAgent(agent)))
  ipcMain.handle('claude:read-skill', (_event, agent: string, id: string) => readClaudeSkill(parseResourceAgent(agent), id))
  ipcMain.handle('claude:save-skill', (_event, agent: string, input) => saveClaudeSkill(parseResourceAgent(agent), input))
  ipcMain.handle('claude:remove-skill', (_event, agent: string, id: string) => removeClaudeSkill(parseResourceAgent(agent), id))
  ipcMain.handle('claude:save-mcp', (_event, agent: string, input) => saveClaudeMcp(parseResourceAgent(agent), input))
  ipcMain.handle('claude:remove-mcp', (_event, agent: string, name: string, scope, projectPath?: string) => removeClaudeMcp(parseResourceAgent(agent), name, scope, projectPath))
  ipcMain.handle('claude:plugin-action', (_event, agent: string, action, id: string) => runClaudePluginAction(parseResourceAgent(agent), action, id))
  ipcMain.handle('claude:reveal', (_event, agent: string, path: string) => revealClaudePath(parseResourceAgent(agent), path))


  acpBridge.on('state', (state) => mainWindow?.webContents.send('acp:state', state))
  acpBridge.on('message', (message) => mainWindow?.webContents.send('acp:message', message))

  automationScheduler = new AutomationScheduler(getAutomationStore(), executeScheduledAutomation)
  automationScheduler.start()
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
})
