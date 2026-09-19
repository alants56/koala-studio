import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Button, Divider, Popover, Tooltip } from 'antd'
import { BranchesOutlined, DiffOutlined, LoadingOutlined, RightOutlined } from '@ant-design/icons'
import type { GitDiffSummary, GitRepositoryStatus } from '@shared/git'
import { GitChangesDialog } from './GitChangesDialog'
import { GitCommitDialog } from './GitCommitDialog'

interface GitStatusPanelProps {
  /** 会话工作目录，通常是所选项目的路径。 */
  cwd: string
}

const EMPTY_DIFF: GitDiffSummary = { additions: 0, deletions: 0, untracked: 0, binary: 0, truncated: false }

/** 行数按千分位展示，改动量大时更易读。 */
function formatLines(value: number): string {
  return value.toLocaleString('zh-CN')
}

/**
 * 会话顶栏右上角的环境信息入口：改动汇总 + 当前分支 + 提交入口。
 * 提交本身在弹出的 GitCommitDialog 里完成，面板只做信息展示。
 * 非 Git 目录不渲染，保持顶栏简洁。
 */
export function GitStatusPanel({ cwd }: GitStatusPanelProps): ReactElement | null {
  const [status, setStatus] = useState<GitRepositoryStatus>()
  const [diff, setDiff] = useState<GitDiffSummary>()
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [commitOpen, setCommitOpen] = useState(false)
  const [changesOpen, setChangesOpen] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    // preload 尚未注入 git API（旧版本覆盖安装）时直接隐藏，避免整页报错。
    if (!cwd || typeof window.git?.status !== 'function' || typeof window.git?.diff !== 'function') {
      setStatus(undefined)
      setDiff(undefined)
      return
    }
    setLoading(true)
    try {
      const [nextStatus, nextDiff] = await Promise.all([window.git.status(cwd), window.git.diff(cwd)])
      setStatus(nextStatus)
      setDiff(nextDiff)
    } catch {
      setStatus(undefined)
      setDiff(undefined)
    } finally {
      setLoading(false)
    }
  }, [cwd])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleOpenChange = (next: boolean): void => {
    setOpen(next)
    // 外部可能已经改过工作区，打开时重新读取。
    if (next) void refresh()
  }

  // 非 Git 目录不展示，保持顶栏简洁。
  if (!status?.isRepository) return null

  const summary = diff ?? EMPTY_DIFF
  const changedFiles = status.changedFiles
  const dirty = changedFiles > 0
  const current = status.branches.find((branch) => branch.current)
  const branchLabel = status.branch ?? status.head ?? '未知'

  const changeDetail = !dirty
    ? '工作区没有未提交的改动'
    : [
        `${changedFiles} 个文件`,
        status.changes.untracked > 0 ? `其中 ${status.changes.untracked} 个新文件` : '',
        summary.binary > 0 ? `${summary.binary} 个二进制文件` : '',
        summary.truncated ? '部分文件未统计' : ''
      ]
        .filter(Boolean)
        .join(' · ')

  const trackingDetail = status.detached
    ? '处于游离 HEAD 状态，提交前建议先切回分支'
    : current
      ? [
          current.upstream ? `跟踪 ${current.upstream}` : '未设置上游分支',
          current.ahead > 0 ? `领先 ${current.ahead}` : '',
          current.behind > 0 ? `落后 ${current.behind}` : ''
        ]
          .filter(Boolean)
          .join(' · ')
      : ''

  const diffCount = (
    <span className="git-diff-count">
      <span className="git-diff-add">+{formatLines(summary.additions)}</span>
      <span className="git-diff-del">−{formatLines(summary.deletions)}</span>
    </span>
  )

  const panel = (
    <div className="git-status-panel">
      <div className="git-status-heading">环境信息</div>

      {/* 改动行整体可点：打开改动详情弹窗，逐文件看行级对比。 */}
      <button
        type="button"
        className="git-status-change"
        disabled={!dirty}
        title={dirty ? '查看改动详情' : changeDetail}
        onClick={() => {
          setOpen(false)
          setChangesOpen(true)
        }}
      >
        <span className="git-status-row">
          <DiffOutlined className="git-status-icon" aria-hidden="true" />
          <span className="git-status-label">变更</span>
          {/* 干净时用破折号，避免展示没有意义的 +0 −0。 */}
          {dirty ? diffCount : <span className="git-status-empty">—</span>}
          {dirty && <RightOutlined className="git-status-entry-arrow" aria-hidden="true" />}
        </span>
        <span className="git-status-sub">{changeDetail}</span>
      </button>

      <Divider className="git-status-divider" />

      <div className="git-status-row">
        <BranchesOutlined className="git-status-icon" aria-hidden="true" />
        <span className="git-status-label">当前分支</span>
        <span className="git-status-branch" title={branchLabel}>{branchLabel}</span>
      </div>
      {trackingDetail && <div className="git-status-sub">{trackingDetail}</div>}

      <Divider className="git-status-divider" />

      <button
        type="button"
        className="git-status-entry"
        onClick={() => {
          setOpen(false)
          setCommitOpen(true)
        }}
      >
        <DiffOutlined className="git-status-icon" aria-hidden="true" />
        <span className="git-status-entry-label">提交或推送</span>
        <RightOutlined className="git-status-entry-arrow" aria-hidden="true" />
      </button>
    </div>
  )

  return (
    <>
      {/* 触发按钮贴右边缘，弹层右对齐才不会溢出窗口。 */}
      <Popover placement="bottomRight" trigger="click" open={open} onOpenChange={handleOpenChange} content={panel}>
        {/* 面板打开时收起 Tooltip，避免两个浮层叠在一起。 */}
        <Tooltip
          title={dirty ? `未提交改动 ${changedFiles} 个文件 +${formatLines(summary.additions)} −${formatLines(summary.deletions)}` : 'Git 环境信息'}
          open={open ? false : undefined}
        >
          <Button
            type="text"
            className="chat-git-status-trigger"
            aria-label={dirty ? `未提交改动 ${changedFiles} 个文件` : 'Git 环境信息'}
            aria-expanded={open}
          >
            {loading && !diff ? <LoadingOutlined spin /> : <DiffOutlined />}
            {/* 改动行数不再展示在图标后，只在弹层与 Tooltip 里给，顶栏保持纯图标。 */}
          </Button>
        </Tooltip>
      </Popover>
      <GitChangesDialog cwd={cwd} open={changesOpen} onClose={() => setChangesOpen(false)} />
      <GitCommitDialog
        cwd={cwd}
        open={commitOpen}
        onClose={() => setCommitOpen(false)}
        onCommitted={() => void refresh()}
      />
    </>
  )
}
