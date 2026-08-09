import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

interface AppPreferences {
  permissionModeId?: string
  lastDirectoryPath?: string
  preferredModelId?: string
}

const STORE_FILE = 'preferences.json'

let cache: AppPreferences | undefined
let writeQueue: Promise<void> = Promise.resolve()

function storePath(): string {
  return join(app.getPath('userData'), STORE_FILE)
}

async function readPreferences(): Promise<AppPreferences> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(storePath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      cache = {}
      return cache
    }
    const preferences = parsed as Record<string, unknown>
    cache = {
      permissionModeId:
        typeof preferences.permissionModeId === 'string' ? preferences.permissionModeId : undefined,
      lastDirectoryPath:
        typeof preferences.lastDirectoryPath === 'string' ? preferences.lastDirectoryPath : undefined,
      preferredModelId:
        typeof preferences.preferredModelId === 'string' ? preferences.preferredModelId : undefined
    }
  } catch {
    cache = {}
  }
  return cache
}

async function updatePreferences(patch: Partial<AppPreferences>): Promise<void> {
  const write = writeQueue.catch(() => undefined).then(async () => {
    const current = await readPreferences()
    const next = { ...current, ...patch }
    const file = storePath()
    await fs.writeFile(`${file}.tmp`, JSON.stringify(next, null, 2), 'utf8')
    await fs.rename(`${file}.tmp`, file)
    cache = next
  })
  writeQueue = write
  await write
}

export async function getPreferredPermissionModeId(): Promise<string | undefined> {
  return (await readPreferences()).permissionModeId
}

export async function setPreferredPermissionModeId(permissionModeId: string): Promise<void> {
  await updatePreferences({ permissionModeId })
}

export async function getLastDirectoryPath(): Promise<string | undefined> {
  return (await readPreferences()).lastDirectoryPath
}

export async function setLastDirectoryPath(lastDirectoryPath: string): Promise<void> {
  await updatePreferences({ lastDirectoryPath })
}

export async function getPreferredModelId(): Promise<string | undefined> {
  return (await readPreferences()).preferredModelId
}

export async function setPreferredModelId(preferredModelId: string): Promise<void> {
  await updatePreferences({ preferredModelId })
}
