/// <reference types="vite/client" />

import type { AcpApi } from '@shared/acp'
import type { ProjectsApi } from '@shared/projects'
import type { ConversationsApi } from '@shared/conversations'
import type { TodosApi } from '@shared/todos'
import type { AttachmentsApi } from '@shared/attachments'
import type { FileActionsApi } from '@shared/files'
import type { GitApi } from '@shared/git'
import type { WorkspaceApi } from '@shared/workspace'

declare global {
  interface Window {
    acp: AcpApi
    projects: ProjectsApi
    conversations: ConversationsApi
    todos: TodosApi
    attachments: AttachmentsApi
    files: FileActionsApi
    workspace: WorkspaceApi
    git: GitApi
  }
}
