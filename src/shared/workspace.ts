/** 应用级信息 API（由 preload 注入）。 */
export interface WorkspaceApi {
  /** 默认工作区目录：项目未指定文件夹时的 ACP 会话 cwd，由主进程按运行环境决定。 */
  getDefaultWorkspace: () => Promise<string>
}
