import { useMemo, useState, type ReactElement } from 'react'
import { CaretDownOutlined, FileOutlined, FolderOutlined } from '@ant-design/icons'
import type { GitChangedFile } from '@shared/git'
import { buildGitChangeTree, CHANGE_KIND_LETTERS, CHANGE_KIND_LABELS, type GitChangeTreeNode } from '@/utils/git-changes'

interface GitChangeTreeProps {
  /** 改动文件清单（来自 git status，路径相对仓库根目录）。 */
  files: GitChangedFile[]
  selectedPath?: string
  onSelect: (file: GitChangedFile) => void
}

interface TreeRowsProps {
  node: GitChangeTreeNode
  depth: number
  collapsed: Set<string>
  onToggle: (path: string) => void
  selectedPath?: string
  onSelect: (file: GitChangedFile) => void
}

/** 文件名（路径最后一段），目录链已经压进父节点名字里。 */
function baseName(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1]
}

function fileRow(file: GitChangedFile, depth: number, selectedPath: string | undefined, onSelect: (file: GitChangedFile) => void): ReactElement {
  const selected = file.path === selectedPath
  return (
    <button
      key={file.path}
      type="button"
      className={`git-tree-row is-file${selected ? ' is-selected' : ''}`}
      style={{ paddingInlineStart: 6 + depth * 14 }}
      title={file.path}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(file)}
    >
      <FileOutlined className="git-tree-icon" aria-hidden="true" />
      <span className="git-tree-name">{baseName(file.path)}</span>
      <span className={`git-change-tag is-${file.kind}`} title={CHANGE_KIND_LABELS[file.kind]}>
        {CHANGE_KIND_LETTERS[file.kind]}
      </span>
    </button>
  )
}

/** 递归渲染一层目录：先目录后文件，目录可折叠。 */
function TreeRows({ node, depth, collapsed, onToggle, selectedPath, onSelect }: TreeRowsProps): ReactElement {
  return (
    <>
      {node.folders.map((folder) => {
        const isCollapsed = collapsed.has(folder.path)
        return (
          <div key={folder.path} className="git-tree-folder">
            <button
              type="button"
              className="git-tree-row is-folder"
              style={{ paddingInlineStart: 6 + depth * 14 }}
              title={folder.path}
              aria-expanded={!isCollapsed}
              onClick={() => onToggle(folder.path)}
            >
              <CaretDownOutlined className={`git-tree-caret${isCollapsed ? ' is-collapsed' : ''}`} aria-hidden="true" />
              <FolderOutlined className="git-tree-icon" aria-hidden="true" />
              <span className="git-tree-name">{folder.name}</span>
              <span className="git-tree-count">{folder.fileCount} 个文件</span>
            </button>
            {!isCollapsed && (
              <TreeRows
                node={folder}
                depth={depth + 1}
                collapsed={collapsed}
                onToggle={onToggle}
                selectedPath={selectedPath}
                onSelect={onSelect}
              />
            )}
          </div>
        )
      })}
      {node.files.map((file) => fileRow(file, depth, selectedPath, onSelect))}
    </>
  )
}

/**
 * 改动详情弹窗左侧的文件树：按目录分组，标注每个文件的变更类型。
 * 默认全部展开，点目录折叠。
 */
export function GitChangeTree({ files, selectedPath, onSelect }: GitChangeTreeProps): ReactElement {
  const tree = useMemo(() => buildGitChangeTree(files), [files])
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const toggle = (path: string): void => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  return (
    <div className="git-tree" aria-label="改动文件">
      <TreeRows node={tree} depth={0} collapsed={collapsed} onToggle={toggle} selectedPath={selectedPath} onSelect={onSelect} />
    </div>
  )
}
