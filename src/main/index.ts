import { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, shell } from 'electron'
import { basename, join, resolve } from 'node:path'
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import type { AttachmentImportInput } from '../shared/attachments'
import type { AgentAdapterId, SessionTarget } from '../shared/acp'
import type { CreateTodoInput, ReorderTodoInput, UpdateTodoInput } from '../shared/todos'
import type { CreateProjectInput, UpdateProjectInput } from '../shared/projects'
import type { UpdateConversationInput } from '../shared/conversations'
import { AcpBridge } from './services/acp-bridge'
import { AcpSessionManager } from './services/acp-session-manager'
import { createProject, deleteProject, listProjects, reorderProjects, updateProject } from './services/project-store'
import { getConversationStore } from './services/conversation-store'
import { getSessionMetaStore } from './services/session-meta-store'
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
import { checkoutGitBranch, commitGitChanges, createGitBranch, getGitDiffSummary, getGitStatus } from './services/git-service'
import { generateCommitMessage } from './services/git-commit-message'
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
const acpBridge = new AcpSessionManager({
  getPreferredAgentId,
  setPreferredAgentId,
  createBridge: (initialAgentId) => new AcpBridge({
    initialAgentId,
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
})
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

  ipcMain.handle('acp:get-state', async (_, target?: SessionTarget) => {
    await acpBridge.getCurrentAgent()
    return acpBridge.getState(target)
  })
  ipcMain.handle('acp:get-session-states', () => acpBridge.getSessionStates())
  ipcMain.handle('acp:connect', (_, cwd: string) => acpBridge.connect(cwd))
  ipcMain.handle('acp:prompt', (_, request) => acpBridge.prompt(request))
  ipcMain.handle('acp:remove-queued-prompt', (_, id: string, target: SessionTarget) => acpBridge.removeQueuedPrompt(id, target))
  ipcMain.handle('acp:steer-queued-prompt', (_, id: string, target: SessionTarget) => acpBridge.steerQueuedPrompt(id, target))
  ipcMain.handle('acp:stop', (_, target: SessionTarget) => acpBridge.stop(target))
  ipcMain.handle('acp:set-mode', (_, modeId: string, target: SessionTarget) => acpBridge.setMode(modeId, target))
  ipcMain.handle('acp:set-model', (_, modelId: string, target: SessionTarget) => acpBridge.setModel(modelId, target))
  ipcMain.handle('acp:set-effort', (_, effortId: string, target: SessionTarget) => acpBridge.setEffort(effortId, target))
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
      // 应用内的重命名 / 归档覆写在读取时合并，侧栏与看板拿到的都是生效后的标题与标记。
      const merged = await getSessionMetaStore().apply(agentId, cwd, sessions)
      // 早期归档没有标题快照：顺带补写，让设置弹窗的归档列表能纯本地渲染（不阻塞返回）。
      void getSessionMetaStore().snapshotArchivedTitles(agentId, cwd, merged).catch(() => undefined)
      return merged.map((session) => ({ ...session, queueDepth: queueCounts.get(session.sessionId) ?? 0 }))
    } finally {
      listingBridge.dispose()
    }
  })
  ipcMain.handle('acp:rename-session', async (_event, cwd: string, sessionId: string, title: string) => {
    await getSessionMetaStore().rename(await acpBridge.getCurrentAgent(), cwd, sessionId, title)
  })
  ipcMain.handle('acp:set-session-archived', async (_event, cwd: string, sessionId: string, archived: boolean, title?: string) => {
    await getSessionMetaStore().setArchived(await acpBridge.getCurrentAgent(), cwd, sessionId, archived, title)
  })
  ipcMain.handle('acp:list-archived-sessions', async () => getSessionMetaStore().listArchived(await acpBridge.getCurrentAgent()))
  ipcMain.handle('acp:delete-session', async (_event, cwd: string, sessionId: string) => {
    const agentId = await acpBridge.getCurrentAgent()
    // 该会话可能还在后台运行：先卸掉运行实例，再删除 Agent 侧记录与本地覆写。
    acpBridge.releaseSession(sessionId, cwd, agentId)
    const deletionBridge = new AcpBridge({ initialAgentId: agentId })
    let warning: string | undefined
    try {
      await deletionBridge.deleteSession(cwd, sessionId)
    } catch (error) {
      // 目录已删除、会话早已不存在等情况下 Agent 侧删不掉；本地索引仍然要清，否则会卡在归档列表里。
      warning = error instanceof Error ? error.message : String(error)
    } finally {
      deletionBridge.dispose()
    }
    await getQueuedPromptStore().replace(agentId, cwd, sessionId, [])
    await getSessionMetaStore().forget(agentId, cwd, sessionId)
    return { agentDeleted: warning === undefined, warning }
  })
  ipcMain.handle('acp:load-session', (_event, sessionId: string, cwd: string, agent: AgentAdapterId) => acpBridge.loadSession(sessionId, cwd, agent))
  ipcMain.handle('acp:create-session', (_event, cwd: string, agent: AgentAdapterId) => acpBridge.createSession(cwd, agent))
  ipcMain.handle('acp:respond-permission', (_event, optionId: string, target: SessionTarget) => acpBridge.respondPermission(optionId, target))

  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:create', (_event, input: CreateProjectInput) => createProject(input))
  ipcMain.handle('projects:update', (_event, id: string, input: UpdateProjectInput) => updateProject(id, input))
  ipcMain.handle('projects:delete', (_event, id: string) => deleteProject(id))
  ipcMain.handle('projects:reorder', (_event, orderedIds: string[]) => reorderProjects(orderedIds))
  ipcMain.handle('projects:pick-directory', () => pickDirectory())
  ipcMain.handle('workspace:get-default', () => getDefaultWorkspace())

  ipcMain.handle('conversations:list', () => getConversationStore().list())
  ipcMain.handle('conversations:create', () => getConversationStore().create())
  ipcMain.handle('conversations:update', (_event, id: string, input: UpdateConversationInput) => getConversationStore().update(id, input))
  ipcMain.handle('conversations:touch', (_event, id: string) => getConversationStore().touch(id))
  ipcMain.handle('conversations:set-archived', (_event, id: string, archived: boolean) => getConversationStore().setArchived(id, archived))
  ipcMain.handle('conversations:delete', (_event, id: string) => getConversationStore().delete(id))

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

  ipcMain.handle('git:status', (_event, cwd: string) => getGitStatus(cwd))
  ipcMain.handle('git:diff', (_event, cwd: string) => getGitDiffSummary(cwd))
  ipcMain.handle('git:checkout', (_event, cwd: string, branch: string) => checkoutGitBranch(cwd, branch))
  ipcMain.handle('git:create-branch', (_event, cwd: string, branch: string) => createGitBranch(cwd, branch))
  ipcMain.handle('git:commit', (_event, cwd: string, message: string, options) => commitGitChanges(cwd, message, options))
  ipcMain.handle('git:generate-commit-message', async (_event, cwd: string) =>
    // 用主进程里持久化的 Agent 偏好决定由谁来生成，不经过渲染层。
    generateCommitMessage(cwd, await acpBridge.getCurrentAgent()))

  ipcMain.handle('todos:list', (_event, input) => getTodoStore().list(input))
  ipcMain.handle('todos:get', (_event, id: string) => getTodoStore().get(id))
  ipcMain.handle('todos:create', (_event, input: CreateTodoInput) => getTodoStore().create(input))
  ipcMain.handle('todos:update', (_event, id: string, input: UpdateTodoInput) => getTodoStore().update(id, input))
  ipcMain.handle('todos:reorder', (_event, items: ReorderTodoInput[]) => getTodoStore().reorder(items))
  ipcMain.handle('todos:set-done', (_event, id: string, done: boolean) => getTodoStore().setDone(id, done))
  ipcMain.handle('todos:delete', (_event, id: string) => getTodoStore().delete(id))

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

app.on('before-quit', () => {
  acpBridge.dispose()
})
