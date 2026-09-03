import { Dropdown, type MenuProps } from 'antd'
import { AppstoreOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { useState, type ReactElement } from 'react'
import type { FileOpenWithApp } from '@shared/files'

const IS_MAC = /Mac|OS X/i.test(navigator.userAgent)

interface FileContextMenuProps {
  /** Dropdown 需要单一 React 元素作为触发节点。 */
  children: ReactElement
  /** 附件 storageKey——提供时走 attachments API（无需 cwd）。 */
  storageKey?: string
  /** 正文引用的文件路径（相对 cwd 或绝对路径），提供时走 files API。 */
  path?: string
  /** 项目工作目录，主进程用它 resolve 相对路径。 */
  cwd?: string
}

/** 对话中引用文件的右键菜单：用应用打开 / 在文件夹（macOS Finder）中显示位置。 */
export function FileContextMenu({ children, storageKey, path, cwd }: FileContextMenuProps): ReactElement {
  const [apps, setApps] = useState<FileOpenWithApp[]>([])
  const [loading, setLoading] = useState(false)

  const handleOpen = (applicationPath?: string): void => {
    if (storageKey) void window.attachments.open(storageKey, applicationPath)
    else if (path) void window.files.open(cwd ?? '', path, applicationPath)
  }
  const handleReveal = (): void => {
    if (storageKey) void window.attachments.reveal(storageKey)
    else if (path) void window.files.reveal(cwd ?? '', path)
  }
  const loadApps = (open: boolean): void => {
    if (!open || loading || apps.length > 0) return
    setLoading(true)
    const request = storageKey
      ? window.attachments.listOpenWithApps(storageKey)
      : path ? window.files.listOpenWithApps(cwd ?? '', path) : Promise.resolve([])
    void request.then(setApps).finally(() => setLoading(false))
  }
  const items: MenuProps['items'] = [
    { key: 'default', icon: <AppstoreOutlined />, label: '默认应用', onClick: () => handleOpen() },
    ...(apps.length > 0 ? apps.map((app) => ({
      key: app.path,
      icon: app.icon ? <img className="file-open-with-app-icon" src={app.icon} alt="" /> : <AppstoreOutlined />,
      label: app.name,
      onClick: () => handleOpen(app.path)
    })) : loading ? [{ key: 'loading', disabled: true, label: '正在查找支持的应用…' }] : []),
    ...(apps.length > 0 || loading ? [{ type: 'divider' as const }] : []),
    { key: 'reveal', icon: <FolderOpenOutlined />, label: IS_MAC ? '在 Finder 中显示' : '在文件夹中显示', onClick: handleReveal }
  ]
  return (
    <Dropdown menu={{ items }} trigger={['contextMenu']} placement="bottomLeft" onOpenChange={loadApps}>
      {children}
    </Dropdown>
  )
}
