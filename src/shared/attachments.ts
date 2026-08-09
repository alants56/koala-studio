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
  open: (storageKey: string) => Promise<void>
}
