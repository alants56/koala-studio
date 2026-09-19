import { useCallback, useEffect, useState, type KeyboardEvent, type ReactElement } from 'react'
import { App, Checkbox, Divider, Input, Modal, Select, Spin } from 'antd'
import {
  BranchesOutlined,
  CheckOutlined,
  CloudUploadOutlined,
  LoadingOutlined,
  RobotOutlined
} from '@ant-design/icons'
import type { GitDiffSummary, GitRepositoryStatus } from '@shared/git'
import { readableIpcError } from '@/utils/ipc-error'
import { useAgentSelection } from '@/state/AgentSelectionContext'

interface GitCommitDialogProps {
  /** 会话工作目录，通常是所选项目的路径。 */
  cwd: string
  open: boolean
  onClose: () => void
  /** 提交成功后通知外层刷新环境信息面板。 */
  onCommitted?: () => void
}

const EMPTY_DIFF: GitDiffSummary = { additions: 0, deletions: 0, untracked: 0, binary: 0, truncated: false }

/** 按平台给出修饰键的展示文案。 */
const MODIFIER_LABEL = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+'

function formatLines(value: number): string {
  return value.toLocaleString('zh-CN')
}

/** 用改动文件数生成一个可提交的兜底说明，Agent 生成失败时使用。 */
function defaultCommitMessage(status?: GitRepositoryStatus): string {
  const files = status?.changedFiles ?? 0
  return files > 0 ? `更新 ${files} 个文件` : ''
}

/**
 * 提交弹窗：写提交说明（留空则由 Agent 依据改动生成）、选择是否带上未暂存的改动。
 * 只写本地仓库，不推送远端。
 */
export function GitCommitDialog({ cwd, open, onClose, onCommitted }: GitCommitDialogProps): ReactElement {
  const { message } = App.useApp()
  const { currentAgent } = useAgentSelection()
  const agentName = currentAgent === 'pi' ? 'Pi' : 'Claude'

  const [status, setStatus] = useState<GitRepositoryStatus>()
  const [diff, setDiff] = useState<GitDiffSummary>()
  const [loading, setLoading] = useState(false)
  const [message_, setMessage] = useState('')
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [switching, setSwitching] = useState(false)

  const diffApi = typeof window !== 'undefined' ? window.git : undefined
  const available = Boolean(cwd) && typeof diffApi?.status === 'function' && typeof diffApi?.diff === 'function'

  const refresh = useCallback(async (): Promise<void> => {
    if (!available) {
      setStatus(undefined)
      setDiff(undefined)
      return
    }
    setLoading(true)
    try {
      const [nextStatus, nextDiff] = await Promise.all([diffApi!.status(cwd), diffApi!.diff(cwd)])
      setStatus(nextStatus)
      setDiff(nextDiff)
    } catch {
      setStatus(undefined)
      setDiff(undefined)
    } finally {
      setLoading(false)
    }
  }, [available, cwd, diffApi])

  // 每次打开都重新读取：弹窗关闭期间工作区可能已经变了。
  useEffect(() => {
    if (!open) return
    setMessage('')
    setIncludeUnstaged(true)
    setGenerating(false)
    setCommitting(false)
    void refresh()
  }, [open, refresh])

  const busy = generating || committing || switching
  const summary = diff ?? EMPTY_DIFF
  const changes = status?.changes
  const stagedCount = changes?.staged ?? 0
  const changedFiles = status?.changedFiles ?? 0
  // 不勾选「包含未暂存的更改」时，只有暂存区有内容才提交得动。
  const committable = includeUnstaged ? changedFiles > 0 : stagedCount > 0
  const disabledReason = !committable
    ? includeUnstaged ? '工作区没有未提交的改动' : '暂存区是空的，请先暂存或勾选「包含未暂存的更改」'
    : ''

  const handleGenerate = async (): Promise<string | undefined> => {
    if (!available || typeof diffApi?.generateCommitMessage !== 'function') {
      void message.warning('当前版本不支持自动生成提交说明')
      return undefined
    }
    setGenerating(true)
    try {
      const generated = await diffApi.generateCommitMessage(cwd)
      setMessage(generated)
      return generated
    } catch (error) {
      // 生成是锦上添花：失败就退回本地兜底文案，不阻断提交。
      const fallback = defaultCommitMessage(status)
      void message.warning(`${readableIpcError(error, '生成提交说明失败')}，已使用默认说明`)
      setMessage(fallback)
      return fallback || undefined
    } finally {
      setGenerating(false)
    }
  }

  const handleCommit = async (): Promise<void> => {
    if (busy || !committable) return
    setCommitting(true)
    try {
      // 留空即自动生成，与输入框 placeholder 的承诺一致。
      const text = message_.trim() || (await handleGenerate())?.trim()
      if (!text) return
      const result = await diffApi!.commit(cwd, text, { includeUnstaged })
      setStatus(result.status)
      setDiff(result.diff)
      setMessage('')
      void message.success(`已提交 ${result.hash}`)
      onCommitted?.()
      onClose()
    } catch (error) {
      void message.error(readableIpcError(error, '提交失败'))
      void refresh()
    } finally {
      setCommitting(false)
    }
  }

  const handleSwitchBranch = async (branch: string): Promise<void> => {
    if (busy || !available || branch === status?.branch) return
    setSwitching(true)
    try {
      setStatus(await diffApi!.checkout(cwd, branch))
      void message.success(`已切换到 ${branch}`)
    } catch (error) {
      void message.error(readableIpcError(error))
      void refresh()
    } finally {
      setSwitching(false)
    }
  }

  /** 只有带修饰键的回车才提交，裸回车留给换行。 */
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    void handleCommit()
  }

  const branchLabel = status?.branch ?? status?.head ?? '未知'
  const branches = status?.branches ?? []

  return (
    <Modal
      open={open}
      onCancel={busy ? undefined : onClose}
      footer={null}
      width={560}
      destroyOnHidden
      mask={{ closable: !busy }}
      className="git-commit-dialog"
      title={null}
      closable={false}
    >
      <div className="git-commit-branch">
        <BranchesOutlined className="git-commit-branch-icon" aria-hidden="true" />
        <Select
          variant="borderless"
          size="small"
          className="git-commit-branch-select"
          value={status?.branch ?? undefined}
          placeholder={branchLabel}
          loading={loading || switching}
          disabled={busy || branches.length === 0}
          aria-label="切换分支"
          onChange={(branch) => void handleSwitchBranch(branch)}
          options={branches.map((branch) => ({ value: branch.name, label: branch.name }))}
          popupMatchSelectWidth={false}
        />
      </div>

      <Input.TextArea
        className="git-commit-message"
        placeholder="提交信息（留空将自动生成）"
        variant="borderless"
        autoSize={{ minRows: 6, maxRows: 12 }}
        maxLength={200}
        value={message_}
        disabled={busy}
        onChange={(event) => setMessage(event.target.value)}
        onKeyDown={handleKeyDown}
      />

      <Divider className="git-commit-divider" />

      <div className="git-commit-option">
        <Checkbox
          checked={includeUnstaged}
          disabled={busy}
          onChange={(event) => setIncludeUnstaged(event.target.checked)}
        >
          包含未暂存的更改
        </Checkbox>
        <span className="git-diff-count">
          <span className="git-diff-add">+{formatLines(summary.additions)}</span>
          <span className="git-diff-del">−{formatLines(summary.deletions)}</span>
        </span>
      </div>

      <button
        type="button"
        className="git-commit-action"
        disabled={busy || !committable}
        onClick={() => void handleGenerate()}
      >
        {generating ? <LoadingOutlined spin /> : <RobotOutlined />}
        <span className="git-commit-action-label">用 {agentName} 生成提交说明</span>
      </button>

      <Divider className="git-commit-divider" />

      <button
        type="button"
        className="git-commit-action is-primary"
        disabled={busy || !committable}
        title={disabledReason}
        onClick={() => void handleCommit()}
      >
        {committing ? <LoadingOutlined spin /> : <CheckOutlined />}
        <span className="git-commit-action-label">提交</span>
        <span className="git-commit-action-hint">{MODIFIER_LABEL}↵</span>
      </button>

      {/* 推送需要访问远端，现有 Git 契约只覆盖本地操作，这里按设计稿留占位。 */}
      <button type="button" className="git-commit-action" disabled title="暂未支持推送远端">
        <CloudUploadOutlined />
        <span className="git-commit-action-label">推送</span>
      </button>

      {loading && !status && (
        <div className="git-commit-loading" role="status" aria-live="polite">
          <Spin size="small" />
        </div>
      )}
      {!loading && !committable && disabledReason && (
        <div className="git-commit-hint">{disabledReason}</div>
      )}
    </Modal>
  )
}
