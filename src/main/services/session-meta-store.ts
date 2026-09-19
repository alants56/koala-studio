import { app } from 'electron'
import { join } from 'node:path'
import { SessionMetaStore } from '../../shared/session-meta-store'

let store: SessionMetaStore | undefined

/** 历史会话的本地元数据索引（自定义标题 / 归档标记），存放在应用数据目录。 */
export function getSessionMetaStore(): SessionMetaStore {
  store ??= new SessionMetaStore(join(app.getPath('userData'), 'session-meta.json'))
  return store
}
