/** 本地 Git 分支信息（对话页底部切换分支使用）。 */
export interface GitBranchInfo {
  /** 本地分支名（不含 refs/heads/ 前缀）。 */
  name: string
  /** 是否为当前检出的分支。 */
  current: boolean
  /** 上游分支名（存在时）。 */
  upstream?: string
  /** 相对上游领先的提交数。 */
  ahead: number
  /** 相对上游落后的提交数。 */
  behind: number
}

/** 工作区 Git 状态快照。非 Git 目录返回 isRepository: false。 */
export interface GitRepositoryStatus {
  isRepository: boolean
  /** 工作区根目录（git rev-parse --show-toplevel）。 */
  worktree?: string
  /** 工作区目录名，用作搜索框提示。 */
  repoName?: string
  /** 当前分支名；detached HEAD 时为空。 */
  branch?: string
  /** 是否处于 detached HEAD。 */
  detached?: boolean
  /** detached HEAD 时的短 commit id。 */
  head?: string
  /** 本地分支列表（按最近提交时间排序）。 */
  branches: GitBranchInfo[]
  /** 未提交文件数（暂存 + 未暂存 + 未跟踪）。 */
  changedFiles: number
  /** 未提交文件在暂存区/工作区的分布，供提交弹窗判断能否只提交暂存内容。 */
  changes: GitChangeCounts
}

/** 未提交文件的分布（同一份 git status 解析得出，三者之和等于 changedFiles）。 */
export interface GitChangeCounts {
  /** 已暂存（已 add）的文件数。 */
  staged: number
  /** 已跟踪但未暂存的改动文件数。 */
  unstaged: number
  /** 未跟踪的新文件数。 */
  untracked: number
}

/** 工作区改动汇总（相对 HEAD；未跟踪文件按全文计入新增）。 */
export interface GitDiffSummary {
  /** 新增行数。 */
  additions: number
  /** 删除行数。 */
  deletions: number
  /** 未跟踪的新文件数（已包含在 GitRepositoryStatus.changedFiles 中）。 */
  untracked: number
  /** 无法按行统计的二进制文件数。 */
  binary: number
  /** 有文件因体积过大被跳过统计，行数只是下限。 */
  truncated: boolean
}

/** 提交行为选项。 */
export interface GitCommitOptions {
  /**
   * 提交前是否先 `git add -A`，把未暂存的改动一并带上，默认 true。
   * 传 false 时只提交暂存区已有的内容。
   */
  includeUnstaged?: boolean
}

/** 提交结果：新提交的标识 + 提交后的工作区快照。 */
export interface GitCommitResult {
  /** 新提交的短 hash。 */
  hash: string
  /** 提交后的工作区状态。 */
  status: GitRepositoryStatus
  /** 提交后的改动汇总（正常情况下已清空）。 */
  diff: GitDiffSummary
}

/** Git 操作 API（由 preload 注入）：仅做本地分支查看、切换与提交，不访问远端。 */
export interface GitApi {
  /** 读取工作区 Git 状态；非 Git 目录返回 isRepository: false。 */
  status: (cwd: string) => Promise<GitRepositoryStatus>
  /** 读取工作区改动汇总；非 Git 目录返回全零。 */
  diff: (cwd: string) => Promise<GitDiffSummary>
  /** 切换到已有本地分支，返回切换后的状态。 */
  checkout: (cwd: string, branch: string) => Promise<GitRepositoryStatus>
  /** 基于当前 HEAD 创建并检出新分支，返回切换后的状态。 */
  createBranch: (cwd: string, branch: string) => Promise<GitRepositoryStatus>
  /** 提交，返回提交结果与提交后的快照。 */
  commit: (cwd: string, message: string, options?: GitCommitOptions) => Promise<GitCommitResult>
  /**
   * 让当前 Agent 依据工作区改动生成一条提交说明。
   * 失败时抛错，调用方应回退到本地默认文案。
   */
  generateCommitMessage: (cwd: string) => Promise<string>
}
