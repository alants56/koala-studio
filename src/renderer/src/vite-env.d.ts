/// <reference types="vite/client" />

import type { AcpApi } from '@shared/acp'
import type { ProjectsApi } from '@shared/projects'
import type { AutomationsApi } from '@shared/automations'
import type { TodosApi } from '@shared/todos'
import type { ClaudeApi } from '@shared/claude'
import type { AttachmentsApi } from '@shared/attachments'
import type { WorkspaceApi } from '@shared/workspace'

declare global {
  interface Window {
    acp: AcpApi
    projects: ProjectsApi
    automations: AutomationsApi
    todos: TodosApi
    claude: ClaudeApi
    attachments: AttachmentsApi
    workspace: WorkspaceApi
  }
}
