export interface FileOpenWithApp {
  name: string
  path: string
  icon?: string
}

/** 文件操作 API（由 preload 注入）：用于打开 / 定位对话正文中引用到的文件路径。 */
export interface FileActionsApi {
  /** 获取可以打开指定路径的应用。 */
  listOpenWithApps: (cwd: string, path: string) => Promise<FileOpenWithApp[]>
  /** 用指定应用打开路径。 */
  open: (cwd: string, path: string, applicationPath?: string) => Promise<void>
  /** 在系统文件夹（macOS Finder / 其他平台资源管理器）中定位路径。 */
  reveal: (cwd: string, path: string) => Promise<void>
}
