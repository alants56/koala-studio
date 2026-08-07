import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type { CreateProjectInput, Project, UpdateProjectInput } from '@shared/projects'
import { projectsApi } from '@/services/projects'

interface ProjectsContextValue {
  projects: Project[]
  loading: boolean
  refresh: () => Promise<void>
  createProject: (input: CreateProjectInput) => Promise<Project>
  updateProject: (id: string, input: UpdateProjectInput) => Promise<Project>
  deleteProject: (id: string) => Promise<void>
  /** 按传入的 id 顺序重排项目列表（拖动排序后提交完整顺序）。 */
  reorderProjects: (orderedIds: string[]) => Promise<void>
  getProject: (id: string) => Project | undefined
  /** 按名称搜索（不区分大小写）。 */
  searchProjects: (query: string) => Project[]
}

const ProjectsContext = createContext<ProjectsContextValue | null>(null)

export function ProjectsProvider({ children }: { children: ReactNode }): ReactElement {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await projectsApi.list()
        if (!cancelled) setProjects(list)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const refresh = useCallback(async () => {
    setProjects(await projectsApi.list())
  }, [])

  const createProject = useCallback(async (input: CreateProjectInput) => {
    const created = await projectsApi.create(input)
    // 新项目在存储层置顶（sortOrder 最小），直接放到列表头部，不再按时间重排。
    setProjects((current) => [created, ...current])
    return created
  }, [])

  const updateProject = useCallback(async (id: string, input: UpdateProjectInput) => {
    const updated = await projectsApi.update(id, input)
    // 编辑只更新内容，保持当前手动排序位置。
    setProjects((current) => current.map((project) => (project.id === id ? updated : project)))
    return updated
  }, [])

  const deleteProject = useCallback(async (id: string) => {
    await projectsApi.delete(id)
    setProjects((current) => current.filter((project) => project.id !== id))
  }, [])

  const reorderProjects = useCallback(async (orderedIds: string[]) => {
    await projectsApi.reorder(orderedIds)
    setProjects((current) => {
      const byId = new Map(current.map((project) => [project.id, project]))
      const ordered = orderedIds.map((id) => byId.get(id)).filter((project): project is Project => project !== undefined)
      return ordered.length === orderedIds.length ? ordered : current
    })
  }, [])

  const getProject = useCallback((id: string) => projects.find((project) => project.id === id), [projects])

  const searchProjects = useCallback(
    (query: string) => {
      const keyword = query.trim().toLowerCase()
      if (!keyword) return projects
      return projects.filter((project) => project.name.toLowerCase().includes(keyword))
    },
    [projects]
  )

  const value = useMemo(
    () => ({ projects, loading, refresh, createProject, updateProject, deleteProject, reorderProjects, getProject, searchProjects }),
    [projects, loading, refresh, createProject, updateProject, deleteProject, reorderProjects, getProject, searchProjects]
  )

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>
}

export function useProjects(): ProjectsContextValue {
  const context = useContext(ProjectsContext)
  if (!context) {
    throw new Error('useProjects 必须在 <ProjectsProvider> 内使用')
  }
  return context
}
