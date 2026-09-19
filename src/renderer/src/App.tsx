import type { ReactElement } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { WorkbenchPage } from '@/pages/workbench/WorkbenchPage'
import { ProjectsPage } from '@/pages/projects/ProjectsPage'
import { ProjectChatPage } from '@/pages/projects/ProjectChatPage'
import { ConversationChatPage } from '@/pages/chats/ConversationChatPage'
import { AgentSelectionProvider } from '@/state/AgentSelectionContext'
import { ProjectsProvider } from '@/state/ProjectsContext'
import { ConversationsProvider } from '@/state/ConversationsContext'

export function App(): ReactElement {
  return (
    <AgentSelectionProvider>
      <ProjectsProvider>
        <ConversationsProvider>
          <HashRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route index element={<Navigate to="/projects" replace />} />
                <Route path="/workbench" element={<WorkbenchPage />} />
                <Route path="/projects" element={<ProjectsPage />} />
                <Route path="/projects/:projectId" element={<ProjectChatPage />} />
                <Route path="/chats/new" element={<ConversationChatPage />} />
                <Route path="/chats/:conversationId" element={<ConversationChatPage />} />
              </Route>
            </Routes>
          </HashRouter>
        </ConversationsProvider>
      </ProjectsProvider>
    </AgentSelectionProvider>
  )
}
