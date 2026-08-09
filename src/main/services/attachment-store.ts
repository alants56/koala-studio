import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app } from 'electron'
import type {
  AttachmentImportInput,
  ChatAttachment,
  ChatAttachmentKind
} from '../../shared/attachments'

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

const STORAGE_KEY_PATTERN = /^[a-f0-9]{2}\/[a-f0-9]{64}(?:\.[a-z0-9]{1,10})?$/
const TEXT_EXTENSIONS = new Set([
  '.bash', '.c', '.cc', '.conf', '.cpp', '.cs', '.css', '.csv', '.fish', '.go', '.gql', '.graphql',
  '.h', '.hpp', '.html', '.ini', '.java', '.js', '.json', '.jsonl', '.jsx', '.kt', '.kts', '.less',
  '.log', '.md', '.markdown', '.py', '.rb', '.rs', '.scss', '.sh', '.sql', '.svelte', '.toml', '.ts',
  '.tsv', '.tsx', '.txt', '.vue', '.xml', '.yaml', '.yml', '.zsh'
])

const MIME_BY_EXTENSION: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
}

function attachmentsRoot(): string {
  return join(app.getPath('userData'), 'chat-assets', 'blobs')
}

function normalizedExtension(name: string): string {
  const extension = extname(name).toLowerCase()
  return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ''
}

function attachmentMimeType(name: string, supplied: string): string {
  return supplied.trim().toLowerCase() || MIME_BY_EXTENSION[normalizedExtension(name)] || 'application/octet-stream'
}

function attachmentKind(name: string, mimeType: string): ChatAttachmentKind {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType === 'application/pdf' || normalizedExtension(name) === '.pdf') return 'pdf'
  if (mimeType.startsWith('text/') || TEXT_EXTENSIONS.has(normalizedExtension(name))) return 'text'
  return 'file'
}

function displayName(name: string): string {
  return basename(name).trim().slice(0, 255) || '未命名附件'
}

export function attachmentFilePath(storageKey: string): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) throw new Error('附件地址无效。')
  const [directory, file] = storageKey.split('/')
  return join(attachmentsRoot(), directory, file)
}

export function attachmentUrl(storageKey: string): string {
  if (!STORAGE_KEY_PATTERN.test(storageKey)) throw new Error('附件地址无效。')
  return `koala-asset://local/${storageKey}`
}

export async function importAttachments(inputs: AttachmentImportInput[]): Promise<ChatAttachment[]> {
  return Promise.all(inputs.map(importAttachment))
}

export async function importAttachment(input: AttachmentImportInput): Promise<ChatAttachment> {
  const bytes = Buffer.from(input.data)
  if (bytes.length === 0) throw new Error(`${input.name || '附件'}为空文件。`)
  if (bytes.length > MAX_ATTACHMENT_BYTES) throw new Error(`${input.name || '附件'}超过 25 MB 限制。`)

  const name = displayName(input.name)
  const mimeType = attachmentMimeType(name, input.mimeType)
  const hash = createHash('sha256').update(bytes).digest('hex')
  const storageKey = `${hash.slice(0, 2)}/${hash}${normalizedExtension(name)}`
  const filePath = attachmentFilePath(storageKey)

  await fs.mkdir(join(attachmentsRoot(), hash.slice(0, 2)), { recursive: true })
  try {
    await fs.writeFile(filePath, bytes, { flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }

  return {
    id: randomUUID(),
    name,
    mimeType,
    size: bytes.length,
    kind: attachmentKind(name, mimeType),
    storageKey,
    url: attachmentUrl(storageKey)
  }
}

export async function readAttachment(attachment: ChatAttachment): Promise<Buffer> {
  return fs.readFile(attachmentFilePath(attachment.storageKey))
}

export function attachmentResourceUri(attachment: ChatAttachment): string {
  return pathToFileURL(attachmentFilePath(attachment.storageKey)).toString()
}
