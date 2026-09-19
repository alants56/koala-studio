import type { GitChangeKind, GitChangedFile, GitFileDiff } from '@shared/git'

/** 变更类型在界面上的短标签。 */
export const CHANGE_KIND_LETTERS: Record<GitChangeKind, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
  conflict: '!'
}

/** 变更类型在界面上的说明文案。 */
export const CHANGE_KIND_LABELS: Record<GitChangeKind, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
  copied: '复制',
  untracked: '未跟踪',
  conflict: '冲突'
}

/** 文件树里的目录节点。 */
export interface GitChangeTreeNode {
  /** 展示名；单一子目录链已合并，例如 `src/renderer/src`。 */
  name: string
  /** 仓库内完整路径，同时作为折叠状态的 key。 */
  path: string
  folders: GitChangeTreeNode[]
  files: GitChangedFile[]
  /** 该目录下的文件总数（含子目录）。 */
  fileCount: number
}

function createFolder(name: string, path: string): GitChangeTreeNode {
  return { name, path, folders: [], files: [], fileCount: 0 }
}

/** 单一子目录链合并成一行，和 VS Code / GitHub 的文件树一致。 */
function compressFolder(folder: GitChangeTreeNode): GitChangeTreeNode {
  let current = folder
  while (current.files.length === 0 && current.folders.length === 1) {
    const child = current.folders[0]
    current = { ...child, name: `${current.name}/${child.name}` }
  }
  return {
    ...current,
    folders: current.folders
      .map(compressFolder)
      .sort((left, right) => left.name.localeCompare(right.name)),
    files: [...current.files].sort((left, right) => left.path.localeCompare(right.path))
  }
}

/**
 * 把改动文件清单按目录聚合成文件树：目录在前、文件在后，单链目录压缩。
 * 返回的根节点不出现在界面上，只作为容器。
 */
export function buildGitChangeTree(files: GitChangedFile[]): GitChangeTreeNode {
  const root = createFolder('', '')
  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean)
    let node = root
    node.fileCount += 1
    for (const segment of segments.slice(0, -1)) {
      let child = node.folders.find((item) => item.name === segment)
      if (!child) {
        child = createFolder(segment, node.path ? `${node.path}/${segment}` : segment)
        node.folders.push(child)
      }
      child.fileCount += 1
      node = child
    }
    node.files.push(file)
  }
  return {
    ...root,
    folders: root.folders
      .map(compressFolder)
      .sort((left, right) => left.name.localeCompare(right.name)),
    files: [...root.files].sort((left, right) => left.path.localeCompare(right.path))
  }
}

/** 每个文件在对比里的改动行数，供工具栏展示 `+a −d`。 */
export function diffLineCounts(diff: GitFileDiff): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const hunk of diff.hunks) {
    for (const row of hunk.rows) {
      if (row.right?.type === 'add') additions += 1
      if (row.left?.type === 'del') deletions += 1
    }
  }
  return { additions, deletions }
}

/** 把行号压成「3、7-9」这样的区间文本。 */
function formatLineRanges(numbers: number[]): string {
  if (numbers.length === 0) return ''
  const sorted = [...new Set(numbers)].sort((left, right) => left - right)
  const parts: string[] = []
  let start = sorted[0]
  let end = sorted[0]
  for (const value of sorted.slice(1)) {
    if (value === end + 1) {
      end = value
      continue
    }
    parts.push(start === end ? `${start}` : `${start}-${end}`)
    start = value
    end = value
  }
  parts.push(start === end ? `${start}` : `${start}-${end}`)
  return parts.join('、')
}

/**
 * 汇总差异块里发生改动的行号：新增行按新文件行号，删除行按旧文件行号。
 * 直接回答「第几行的内容被改了」。
 */
export function describeChangedLines(diff: GitFileDiff): string {
  const added: number[] = []
  const deleted: number[] = []
  for (const hunk of diff.hunks) {
    for (const row of hunk.rows) {
      if (row.right?.type === 'add' && row.right.newNumber !== undefined) added.push(row.right.newNumber)
      if (row.left?.type === 'del' && row.left.oldNumber !== undefined) deleted.push(row.left.oldNumber)
    }
  }
  const parts: string[] = []
  if (added.length > 0) parts.push(`新增 ${formatLineRanges(added)} 行`)
  if (deleted.length > 0) parts.push(`删除 ${formatLineRanges(deleted)} 行`)
  return parts.join(' · ')
}
