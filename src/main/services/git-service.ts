import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  GitBranchInfo,
  GitChangeCounts,
  GitCommitOptions,
  GitCommitResult,
  GitDiffSummary,
  GitRepositoryStatus
} from '../../shared/git'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 15_000
const GIT_MAX_BUFFER = 4 * 1024 * 1024
/** 未跟踪文件要逐个读取，限制文件数与单文件体积，避免在大目录上卡住。 */
const DIFF_MAX_FILES = 500
const DIFF_MAX_FILE_BYTES = 1024 * 1024

const NO_CHANGES: GitChangeCounts = { staged: 0, unstaged: 0, untracked: 0 }
const NOT_A_REPOSITORY: GitRepositoryStatus = { isRepository: false, branches: [], changedFiles: 0, changes: NO_CHANGES }
const EMPTY_DIFF: GitDiffSummary = { additions: 0, deletions: 0, untracked: 0, binary: 0, truncated: false }

interface RunGitOptions {
  /** 只读命令置 true：避免 git status 之类的查询去抢 index.lock。 */
  readOnly?: boolean
}

async function runGit(cwd: string, args: string[], options: RunGitOptions = {}): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
    env: options.readOnly ? { ...process.env, GIT_OPTIONAL_LOCKS: '0' } : process.env
  })
  return stdout
}

/** 从 git 的 stderr 提取可读错误，避免把整个命令行回显给用户。 */
function gitFailure(error: unknown, fallback: string): Error {
  const stderr = error && typeof error === 'object' && 'stderr' in error ? String((error as { stderr?: string }).stderr ?? '').trim() : ''
  const lines = stderr
    .split('\n')
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith('Command failed'))
  const reason = lines[0]?.replace(/^(?:fatal|error):\s*/, '').replace(/:$/, '')
  if (!reason) return new Error(fallback)
  // 切换分支被未提交改动拦住时，把 git 的后续提示一并带上。
  const hint = lines.slice(1).find((item) => /^(?:please|hint:)\b/i.test(item))
  const cleanHint = hint?.replace(/^hint:\s*/i, '')
  return new Error(cleanHint ? `${reason}。${cleanHint}` : reason)
}

/** `%(upstream:track,nobracket)` 输出，例如 "ahead 1, behind 2"。 */
function parseTrack(track: string): { ahead: number; behind: number } {
  const ahead = /ahead\s+(\d+)/.exec(track)?.[1]
  const behind = /behind\s+(\d+)/.exec(track)?.[1]
  return { ahead: ahead ? Number(ahead) : 0, behind: behind ? Number(behind) : 0 }
}

/**
 * 统计 `git status --porcelain=v1 -z` 的文件数。
 * 重命名 / 复制条目会额外带一个原始路径字段，需要跳过，否则会重复计数。
 */
export function countChangedFiles(rawStatus: string): number {
  const entries = rawStatus.split('\0')
  let count = 0
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    count += 1
    const code = entry.slice(0, 2)
    if (code[0] === 'R' || code[0] === 'C') index += 1
  }
  return count
}

/**
 * 解析 `git status --porcelain=v1 -z`，按 XY 两列拆分暂存与未暂存。
 * X 是暂存区相对 HEAD 的状态，Y 是工作区相对暂存区的状态；
 * `??` 表示未跟踪。重命名 / 复制条目带一个额外的原始路径字段，需要跳过。
 */
export function parsePorcelain(rawStatus: string): GitChangeCounts {
  const counts: GitChangeCounts = { ...NO_CHANGES }
  const entries = rawStatus.split('\0')
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    const [indexStatus, worktreeStatus] = entry.slice(0, 2)
    if (indexStatus === 'R' || indexStatus === 'C') index += 1

    if (indexStatus === '?' && worktreeStatus === '?') {
      counts.untracked += 1
      continue
    }
    if (indexStatus !== ' ' && indexStatus !== '?') counts.staged += 1
    if (worktreeStatus !== ' ' && worktreeStatus !== '?') counts.unstaged += 1
  }
  return counts
}

/** 解析 `for-each-ref` 输出；制表符分隔：name / HEAD 标记 / upstream / track。 */
export function parseBranchList(raw: string): GitBranchInfo[] {
  return raw
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [name, head, upstream, track = ''] = line.split('\t')
      const { ahead, behind } = parseTrack(track)
      return { name, current: head === '*', upstream: upstream || undefined, ahead, behind }
    })
}

/**
 * 汇总 `git diff --numstat` 输出。
 * 二进制文件没有行数，该行是 `-\t-\tpath`，单独计数。
 */
export function parseNumstat(raw: string): Pick<GitDiffSummary, 'additions' | 'deletions' | 'binary'> {
  let additions = 0
  let deletions = 0
  let binary = 0
  for (const line of raw.split('\n')) {
    if (!line) continue
    const [added, deleted] = line.split('\t')
    if (added === '-') {
      binary += 1
      continue
    }
    additions += Number(added) || 0
    deletions += Number(deleted) || 0
  }
  return { additions, deletions, binary }
}

/** 统计换行符数量；文件末尾没有换行符时最后一行同样计入。 */
export function countBufferLines(buffer: Buffer): number {
  if (buffer.length === 0) return 0
  let breaks = 0
  for (const byte of buffer) {
    if (byte === 0x0a) breaks += 1
  }
  return buffer[buffer.length - 1] === 0x0a ? breaks : breaks + 1
}

/**
 * 统计未跟踪文件的行数（numstat 只覆盖已跟踪文件）。
 * 从仓库根目录读取，这样 ls-files 输出的相对路径可以直接拼成绝对路径。
 */
async function summarizeUntracked(root: string): Promise<GitDiffSummary> {
  const summary: GitDiffSummary = { ...EMPTY_DIFF }
  const listing = await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z'], { readOnly: true }).catch(() => '')
  const paths = listing.split('\0').filter(Boolean)
  summary.untracked = paths.length
  if (paths.length > DIFF_MAX_FILES) summary.truncated = true

  for (const path of paths.slice(0, DIFF_MAX_FILES)) {
    let buffer: Buffer
    try {
      const info = await stat(join(root, path))
      if (!info.isFile()) continue
      if (info.size > DIFF_MAX_FILE_BYTES) {
        summary.truncated = true
        continue
      }
      buffer = await readFile(join(root, path))
    } catch {
      // 统计期间文件被删除、或是读不到的软链接，跳过即可。
      continue
    }
    if (buffer.includes(0)) {
      summary.binary += 1
      continue
    }
    summary.additions += countBufferLines(buffer)
  }
  return summary
}

/** 读取工作区改动汇总；非 Git 目录返回全零。 */
export async function getGitDiffSummary(cwd: string): Promise<GitDiffSummary> {
  if (!cwd) return { ...EMPTY_DIFF }

  let root = ''
  try {
    root = (await runGit(cwd, ['rev-parse', '--show-toplevel'], { readOnly: true })).trim()
  } catch {
    return { ...EMPTY_DIFF }
  }

  let numstat = ''
  try {
    numstat = await runGit(cwd, ['diff', 'HEAD', '--numstat'], { readOnly: true })
  } catch {
    // 空仓库还没有 HEAD，退回暂存区与空树的差异。
    numstat = await runGit(cwd, ['diff', '--cached', '--numstat'], { readOnly: true }).catch(() => '')
  }

  const tracked = parseNumstat(numstat)
  const untracked = await summarizeUntracked(root || cwd)
  return {
    additions: tracked.additions + untracked.additions,
    deletions: tracked.deletions + untracked.deletions,
    untracked: untracked.untracked,
    binary: tracked.binary + untracked.binary,
    truncated: untracked.truncated
  }
}

/** 读取工作区 Git 状态；cwd 不存在或不是 Git 仓库时返回 isRepository: false。 */
export async function getGitStatus(cwd: string): Promise<GitRepositoryStatus> {
  if (!cwd) return NOT_A_REPOSITORY

  try {
    const inside = (await runGit(cwd, ['rev-parse', '--is-inside-work-tree'], { readOnly: true })).trim()
    if (inside !== 'true') return NOT_A_REPOSITORY
  } catch {
    return NOT_A_REPOSITORY
  }

  const [worktree, branch, head, branchRefs, porcelain] = await Promise.all([
    runGit(cwd, ['rev-parse', '--show-toplevel'], { readOnly: true }),
    runGit(cwd, ['symbolic-ref', '--short', '-q', 'HEAD'], { readOnly: true }).catch(() => ''),
    runGit(cwd, ['rev-parse', '--short', 'HEAD'], { readOnly: true }).catch(() => ''),
    runGit(
      cwd,
      ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(upstream:track,nobracket)', 'refs/heads'],
      { readOnly: true }
    ),
    runGit(cwd, ['status', '--porcelain=v1', '-z'], { readOnly: true })
  ])

  const currentBranch = branch.trim()
  const branches = parseBranchList(branchRefs)
  // 空仓库（git init 后还没有提交）HEAD 指向的分支不会出现在 refs/heads 里，补上它。
  if (currentBranch && !branches.some((item) => item.name === currentBranch)) {
    branches.unshift({ name: currentBranch, current: true, ahead: 0, behind: 0 })
  }

  const root = worktree.trim()
  return {
    isRepository: true,
    worktree: root,
    repoName: root ? basename(root) : undefined,
    branch: currentBranch || undefined,
    detached: !currentBranch,
    head: currentBranch ? undefined : head.trim() || undefined,
    branches,
    changedFiles: countChangedFiles(porcelain),
    changes: parsePorcelain(porcelain)
  }
}

function assertBranchName(branch: string): string {
  const name = branch.trim()
  if (!name) throw new Error('分支名不能为空')
  return name
}

/** 切换到已有本地分支。 */
export async function checkoutGitBranch(cwd: string, branch: string): Promise<GitRepositoryStatus> {
  const name = assertBranchName(branch)
  try {
    await runGit(cwd, ['checkout', name])
  } catch (error) {
    throw gitFailure(error, `无法切换到分支 ${name}`)
  }
  return getGitStatus(cwd)
}

/** 基于当前 HEAD 创建并检出新分支。 */
export async function createGitBranch(cwd: string, branch: string): Promise<GitRepositoryStatus> {
  const name = assertBranchName(branch)
  try {
    await runGit(cwd, ['check-ref-format', '--branch', name])
  } catch {
    throw new Error('分支名不合法，不能包含空格或 ~ ^ : ? * [ \\ 等字符')
  }
  try {
    await runGit(cwd, ['checkout', '-b', name])
  } catch (error) {
    throw gitFailure(error, `无法创建分支 ${name}`)
  }
  return getGitStatus(cwd)
}

/**
 * 提交改动。默认先 `git add -A` 再提交（把所有改动都带上）；
 * 传 `includeUnstaged: false` 时只提交暂存区已有的内容，未暂存的改动留在工作区。
 * 走用户自己的 git 配置，不额外传 -c，签名 / 钩子等行为与命令行一致。
 */
export async function commitGitChanges(
  cwd: string,
  message: string,
  options: GitCommitOptions = {}
): Promise<GitCommitResult> {
  const summary = message.trim()
  if (!summary) throw new Error('提交说明不能为空')

  const includeUnstaged = options.includeUnstaged !== false
  const porcelain = await runGit(cwd, ['status', '--porcelain=v1', '-z'], { readOnly: true }).catch(() => '')
  const changes = parsePorcelain(porcelain)

  if (includeUnstaged) {
    if (countChangedFiles(porcelain) === 0) throw new Error('当前没有需要提交的改动')
    try {
      await runGit(cwd, ['add', '-A'])
    } catch (error) {
      throw gitFailure(error, '无法暂存改动')
    }
  } else if (changes.staged === 0) {
    // 不勾选「包含未暂存的更改」时，暂存区为空就没有可提交内容。
    throw new Error('没有已暂存的改动，请先暂存或勾选「包含未暂存的更改」')
  }
  try {
    await runGit(cwd, ['commit', '-m', summary])
  } catch (error) {
    throw gitFailure(error, '提交失败')
  }

  const hash = (await runGit(cwd, ['rev-parse', '--short', 'HEAD'], { readOnly: true })).trim()
  const [status, diff] = await Promise.all([getGitStatus(cwd), getGitDiffSummary(cwd)])
  return { hash, status, diff }
}
