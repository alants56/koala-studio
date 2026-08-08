import { app } from 'electron'
import { join } from 'node:path'
import { AutomationStore } from '../../shared/automation-store'

let store: AutomationStore | undefined

export function automationsFilePath(): string {
  return join(app.getPath('userData'), 'automations.json')
}

export function getAutomationStore(): AutomationStore {
  store ??= new AutomationStore(automationsFilePath())
  return store
}
