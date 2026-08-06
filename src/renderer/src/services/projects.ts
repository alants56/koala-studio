import type { ProjectsApi } from '@shared/projects'

/** 渲染进程访问本地项目存储的唯一入口（由 preload 注入）。 */
export const projectsApi: ProjectsApi = window.projects
