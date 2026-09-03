export type ChatAttachmentKind = 'image' | 'pdf' | 'text' | 'file'

export interface ChatAttachment {
  id: string
  name: string
  mimeType: string
  size: number
  kind: ChatAttachmentKind
  storageKey: string
  url: string
}

export interface AttachmentImportInput {
  name: string
  mimeType: string
  data: Uint8Array
}

export interface AttachmentsApi {
  importFiles: (files: AttachmentImportInput[]) => Promise<ChatAttachment[]>
  listOpenWithApps: (storageKey: string) => Promise<Array<{ name: string; path: string; icon?: string }>>
  open: (storageKey: string, applicationPath?: string) => Promise<void>
  /** 在系统文件夹（macOS Finder / 其他平台资源管理器）中定位附件。 */
  reveal: (storageKey: string) => Promise<void>
}
