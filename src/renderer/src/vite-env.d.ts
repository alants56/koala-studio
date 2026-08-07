/// <reference types="vite/client" />

import type { AcpApi } from '@shared/acp'
import type { ProjectsApi } from '@shared/projects'
import type { ClaudeApi } from '@shared/claude'

declare global {
  interface Window {
    acp: AcpApi
    projects: ProjectsApi
    claude: ClaudeApi
  }
}
