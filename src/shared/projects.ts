/** 本地项目：元数据 + 可选的 ACP 会话工作目录。 */
export interface Project {
  id: string
  name: string
  description: string
  /** ACP 会话工作目录；未指定时回退到默认工作区。 */
  path?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateProjectInput {
  name: string
  description: string
  tags: string[]
  /** 项目文件夹；通过系统目录选择对话框选择或新建。 */
  path?: string
}

export type UpdateProjectInput = CreateProjectInput

export interface ProjectsApi {
  list: () => Promise<Project[]>
  create: (input: CreateProjectInput) => Promise<Project>
  update: (id: string, input: UpdateProjectInput) => Promise<Project>
  delete: (id: string) => Promise<void>
  /** 打开系统目录选择对话框（支持选择已有文件夹或新建文件夹）。 */
  pickDirectory: () => Promise<string | null>
}
