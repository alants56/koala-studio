import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { Modal, Spin } from 'antd'
import type { GitChangeList, GitDiffSummary, GitFileDiff } from '@shared/git'
import { GitChangeTree } from './GitChangeTree'
import { GitFileDiffView } from './GitFileDiffView'

interface GitChangesDialogProps {
  /** 会话工作目录，通常是所选项目的路径。 */
  cwd: string
  open: boolean
  onClose: () => void
}

function formatLines(value: number): string {
  return `+${value.toLocaleString('zh-CN')}`
}

/**
 * 改动详情弹窗：左侧是「哪个文件夹下的哪些文件变了」的文件树，
 * 右侧是选中文件的前后并排对比（行号 + 改动行着色）。
 */
export function GitChangesDialog({ cwd, open, onClose }: GitChangesDialogProps): ReactElement {
  const [list, setList] = useState<GitChangeList>()
  const [summary, setSummary] = useState<GitDiffSummary>()
  const [listLoading, setListLoading] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string>()
  const [diff, setDiff] = useState<GitFileDiff>()
  const [diffLoading, setDiffLoading] = useState(false)
  // 请求序号：文件切换很快时丢弃过期响应，避免旧结果盖住新选中文件。
  const listRequest = useRef(0)
  const diffRequest = useRef(0)

  const git = typeof window === 'undefined' ? undefined : window.git
  const available = Boolean(cwd) && typeof git?.changes === 'function' && typeof git?.fileDiff === 'function'

  const loadList = useCallback(async (): Promise<void> => {
    const request = (listRequest.current += 1)
    if (!available) {
      setList(undefined)
      setSummary(undefined)
      return
    }
    setListLoading(true)
    try {
      const [nextList, nextSummary] = await Promise.all([git!.changes(cwd), git!.diff(cwd)])
      if (request !== listRequest.current) return
      setList(nextList)
      setSummary(nextSummary)
      // 默认选中第一个文件，打开弹窗就能直接看到改动。
      setSelectedPath((current) =>
        current && nextList.files.some((file) => file.path === current) ? current : nextList.files[0]?.path
      )
    } catch {
      if (request === listRequest.current) {
        setList(undefined)
        setSummary(undefined)
      }
    } finally {
      if (request === listRequest.current) setListLoading(false)
    }
  }, [available, cwd, git])

  // 每次打开都重新读取：弹窗关闭期间工作区可能已经变了。
  useEffect(() => {
    if (!open) return
    setSelectedPath(undefined)
    setDiff(undefined)
    void loadList()
  }, [open, loadList])

  useEffect(() => {
    if (!open || !available || !selectedPath) return
    const request = (diffRequest.current += 1)
    setDiff(undefined)
    setDiffLoading(true)
    git!
      .fileDiff(cwd, selectedPath)
      .then((next) => {
        if (request === diffRequest.current) setDiff(next)
      })
      .catch(() => {
        if (request === diffRequest.current) setDiff(undefined)
      })
      .finally(() => {
        if (request === diffRequest.current) setDiffLoading(false)
      })
  }, [available, cwd, git, open, selectedPath])

  const files = list?.files ?? []

  const title = (
    <div className="git-changes-heading">
      <span className="git-changes-title">改动</span>
      {files.length > 0 && <span className="git-changes-meta">{files.length} 个文件</span>}
      {summary && (summary.additions > 0 || summary.deletions > 0) && (
        <span className="git-diff-count">
          <span className="git-diff-add">{formatLines(summary.additions)}</span>
          <span className="git-diff-del">−{summary.deletions.toLocaleString('zh-CN')}</span>
        </span>
      )}
    </div>
  )

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1280}
      centered
      destroyOnHidden
      className="git-changes-dialog"
      title={title}
    >
      <div className="git-changes-body">
        <aside className="git-changes-tree">
          {listLoading && files.length === 0 ? (
            <div className="git-changes-tree-loading" role="status" aria-live="polite">
              <Spin size="small" />
            </div>
          ) : files.length === 0 ? (
            <div className="git-changes-tree-empty">工作区没有未提交的改动</div>
          ) : (
            <GitChangeTree files={files} selectedPath={selectedPath} onSelect={(file) => setSelectedPath(file.path)} />
          )}
          {list?.truncated && <div className="git-changes-tree-note">改动文件过多，仅列出前一部分</div>}
        </aside>
        <section className="git-changes-diff">
          <GitFileDiffView diff={diff} loading={diffLoading} />
        </section>
      </div>
    </Modal>
  )
}
