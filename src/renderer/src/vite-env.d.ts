/// <reference types="vite/client" />

import type { AcpApi } from '@shared/acp'
import type { ProjectsApi } from '@shared/projects'

declare global {
  interface Window {
    acp: AcpApi
    projects: ProjectsApi
  }
}
