import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { App, Button, Divider, Input, Popover, Spin } from 'antd'
import { BranchesOutlined, CheckOutlined, LoadingOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import type { GitRepositoryStatus } from '@shared/git'
import { readableIpcError } from '@/utils/ipc-error'

interface GitBranchPickerProps {
  /** 会话工作目录，通常是所选项目的路径。 */
  cwd: string
}

/** 输入区底部的 Git 分支选择器：查看本地分支、切换分支、创建并检出新分支。 */
export function GitBranchPicker({ cwd }: GitBranchPickerProps): ReactElement | null {
  const { message } = App.useApp()
  const [status, setStatus] = useState<GitRepositoryStatus>()
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [pendingBranch, setPendingBranch] = useState<string>()
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [createPending, setCreatePending] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    // preload 尚未注入 git API（旧版本覆盖安装）时直接隐藏，避免整页报错。
    if (!cwd || typeof window.git?.status !== 'function') {
      setStatus(undefined)
      return
    }
    setLoading(true)
    try {
      setStatus(await window.git.status(cwd))
    } catch {
      setStatus(undefined)
    } finally {
      setLoading(false)
    }
  }, [cwd])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const branches = status?.branches ?? []
  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return keyword ? branches.filter((branch) => branch.name.toLowerCase().includes(keyword)) : branches
  }, [branches, query])

  const busy = pendingBranch !== undefined || createPending

  const handleOpenChange = (next: boolean): void => {
    setOpen(next)
    if (next) {
      setQuery('')
      setCreating(false)
      setDraft('')
      // 外部可能已经改过分支，打开时重新读取。
      void refresh()
    }
  }

  const handleSwitch = async (branch: string): Promise<void> => {
    if (busy || branch === status?.branch) return
    setPendingBranch(branch)
    try {
      const next = await window.git.checkout(cwd, branch)
      setStatus(next)
      setOpen(false)
      void message.success(`已切换到 ${next.branch ?? branch}`)
    } catch (error) {
      void message.error(readableIpcError(error))
      void refresh()
    } finally {
      setPendingBranch(undefined)
    }
  }

  const handleCreate = async (): Promise<void> => {
    const name = draft.trim()
    if (!name || busy) return
    setCreatePending(true)
    try {
      const next = await window.git.createBranch(cwd, name)
      setStatus(next)
      setOpen(false)
      setCreating(false)
      setDraft('')
      void message.success(`已创建并切换到 ${next.branch ?? name}`)
    } catch (error) {
      void message.error(readableIpcError(error))
    } finally {
      setCreatePending(false)
    }
  }

  // 非 Git 目录不展示，保持输入区简洁。
  if (!status?.isRepository) return null

  const currentLabel = status.branch ?? status.head ?? '分支'

  const panel = (
    <div className="git-branch-panel">
      <Input
        className="git-branch-search"
        size="small"
        allowClear
        prefix={<SearchOutlined />}
        placeholder={status.repoName ? `搜索 ${status.repoName} 分支` : '搜索分支'}
        value={query}
        disabled={busy}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="git-branch-section">分支</div>
      <div className="git-branch-list" role="listbox" aria-label="本地分支">
        {loading && branches.length === 0 ? (
          <div className="git-branch-loading" role="status" aria-live="polite"><Spin size="small" /></div>
        ) : filtered.length === 0 ? (
          <div className="git-branch-empty">{branches.length === 0 ? '暂无本地分支' : `未找到「${query.trim()}」`}</div>
        ) : (
          filtered.map((branch) => (
            <button
              key={branch.name}
              type="button"
              role="option"
              aria-selected={branch.current}
              className={`git-branch-item${branch.current ? ' is-current' : ''}`}
              disabled={busy}
              onClick={() => void handleSwitch(branch.name)}
            >
              <BranchesOutlined className="git-branch-item-icon" aria-hidden="true" />
              <span className="git-branch-item-copy">
                <span className="git-branch-item-name" title={branch.name}>{branch.name}</span>
                {branch.current && status.changedFiles > 0 && (
                  <span className="git-branch-item-meta">未提交：{status.changedFiles} 个文件</span>
                )}
                {!branch.current && (branch.ahead > 0 || branch.behind > 0) && (
                  <span className="git-branch-item-meta">
                    {branch.ahead > 0 ? `领先 ${branch.ahead}` : ''}
                    {branch.ahead > 0 && branch.behind > 0 ? ' · ' : ''}
                    {branch.behind > 0 ? `落后 ${branch.behind}` : ''}
                  </span>
                )}
              </span>
              {pendingBranch === branch.name
                ? <LoadingOutlined spin className="git-branch-item-check" />
                : branch.current
                  ? <CheckOutlined className="git-branch-item-check" />
                  : null}
            </button>
          ))
        )}
      </div>
      <Divider className="git-branch-divider" />
      {creating ? (
        <div className="git-branch-create-row">
          <Input
            size="small"
            autoFocus
            maxLength={200}
            value={draft}
            placeholder="新分支名称"
            disabled={createPending}
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={() => void handleCreate()}
          />
          <Button size="small" type="primary" loading={createPending} disabled={!draft.trim()} onClick={() => void handleCreate()}>
            创建
          </Button>
        </div>
      ) : (
        <button type="button" className="git-branch-create" disabled={busy} onClick={() => setCreating(true)}>
          <PlusOutlined /> 创建并检出新分支…
        </button>
      )}
    </div>
  )

  return (
    <Popover placement="topLeft" trigger="click" open={open} onOpenChange={handleOpenChange} content={panel}>
      <Button
        type="text"
        className="chat-git-trigger"
        icon={<BranchesOutlined />}
        title={currentLabel}
        aria-label={`Git 分支：${currentLabel}`}
        aria-expanded={open}
      >
        <span className="chat-git-trigger-name">{currentLabel}</span>
      </Button>
    </Popover>
  )
}
