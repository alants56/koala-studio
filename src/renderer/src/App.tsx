import type { ReactElement } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { WorkbenchPage } from '@/pages/workbench/WorkbenchPage'
import { ProjectsPage } from '@/pages/projects/ProjectsPage'
import { ProjectChatPage } from '@/pages/projects/ProjectChatPage'
import { ProjectsProvider } from '@/state/ProjectsContext'

export function App(): ReactElement {
  return (
    <ProjectsProvider>
      <HashRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/projects" replace />} />
            <Route path="/workbench" element={<WorkbenchPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<ProjectChatPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </ProjectsProvider>
  )
}
