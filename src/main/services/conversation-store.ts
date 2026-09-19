import { app } from 'electron'
import { join } from 'node:path'
import { ConversationStore } from '../../shared/conversation-store'

let store: ConversationStore | undefined

/**
 * 仅对话目录的根路径：应用数据目录下的 conversations/。
 * 应用路径（尤其是打包后的安装目录）通常不可写，用户主目录又会被时间戳目录污染，
 * 因此对话目录统一放在应用自己的数据目录里，不对外展示。
 */
export function conversationsRootDir(): string {
  return join(app.getPath('userData'), 'conversations')
}

export function getConversationStore(): ConversationStore {
  store ??= new ConversationStore(join(app.getPath('userData'), 'conversations.json'), conversationsRootDir())
  return store
}
