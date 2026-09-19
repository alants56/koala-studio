import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { promisify } from 'node:util'
import type {
  GitBranchInfo,
  GitChangeCounts,
  GitChangeKind,
  GitChangeList,
  GitChangedFile,
  GitCommitOptions,
  GitCommitResult,
  GitDiffHunk,
  GitDiffLine,
  GitDiffRow,
  GitDiffSummary,
  GitFileDiff,
  GitRepositoryStatus
} from '../../shared/git'

const execFileAsync = promisify(execFile)

const GIT_TIMEOUT_MS = 15_000
const GIT_MAX_BUFFER = 4 * 1024 * 1024
/** 未跟踪文件要逐个读取，限制文件数与单文件体积，避免在大目录上卡住。 */
const DIFF_MAX_FILES = 500
const DIFF_MAX_FILE_BYTES = 1024 * 1024
/** 改动详情弹窗的文件树 / 行级对比的行数上限，避免超大 diff 拖垮渲染。 */
const CHANGE_LIST_MAX_FILES = 2_000
const FILE_DIFF_MAX_ROWS = 3_000

const NO_CHANGES: GitChangeCounts = { staged: 0, unstaged: 0, untracked: 0 }
const NOT_A_REPOSITORY: GitRepositoryStatus = { isRepository: false, branches: [], changedFiles: 0, changes: NO_CHANGES }
const EMPTY_DIFF: GitDiffSummary = { additions: 0, deletions: 0, untracked: 0, binary: 0, truncated: false }
const EMPTY_CHANGE_LIST: GitChangeList = { isRepository: false, files: [], truncated: false }

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

/** 把 porcelain 的 XY 状态码归一化成界面用的变更类型。 */
export function classifyGitChange(indexStatus: string, worktreeStatus: string): GitChangeKind {
  if (indexStatus === '?' || worktreeStatus === '?') return 'untracked'
  // 冲突（UU / AA / DD / AU / UA / DU / UD）优先于其它状态判断。
  if (
    indexStatus === 'U' ||
    worktreeStatus === 'U' ||
    (indexStatus === 'A' && worktreeStatus === 'A') ||
    (indexStatus === 'D' && worktreeStatus === 'D')
  ) {
    return 'conflict'
  }
  if (indexStatus === 'R' || worktreeStatus === 'R') return 'renamed'
  if (indexStatus === 'C' || worktreeStatus === 'C') return 'copied'
  if (indexStatus === 'D' || worktreeStatus === 'D') return 'deleted'
  if (indexStatus === 'A' || worktreeStatus === 'A') return 'added'
  return 'modified'
}

/**
 * 解析 `git status --porcelain=v1 -z`，保留每个文件的路径与状态。
 * `-z` 格式下重命名 / 复制条目会多出一个「原始路径」字段，紧跟在目标路径之后。
 */
export function parseStatusFiles(rawStatus: string): GitChangedFile[] {
  const files: GitChangedFile[] = []
  const entries = rawStatus.split('\0')
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (!entry) continue
    const [indexStatus, worktreeStatus] = entry.slice(0, 2)
    const path = entry.slice(3)
    const renamed = indexStatus === 'R' || indexStatus === 'C'
    const originalPath = renamed ? entries[index + 1] || undefined : undefined
    if (renamed) index += 1
    if (!path) continue
    files.push({
      path,
      status: `${indexStatus}${worktreeStatus}`,
      kind: classifyGitChange(indexStatus, worktreeStatus),
      originalPath
    })
  }
  return files
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

/** 按行切分文件内容，兼容 CRLF，并丢掉末尾换行带来的空行。 */
export function splitFileLines(text: string): string[] {
  if (!text) return []
  const lines = text.split(/\r?\n/)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** 用 NUL 字节判断二进制，和 `summarizeUntracked` 保持一致。 */
function isBinaryBuffer(buffer: Buffer): boolean {
  return buffer.includes(0)
}

/**
 * 把差异行按「删除一组、新增一组」左右配对，得到并排对比用的行。
 * 连续的删除行与新增行一一对应，多出来的一侧留空。
 */
export function pairDiffLines(lines: GitDiffLine[]): GitDiffRow[] {
  const rows: GitDiffRow[] = []
  let pendingDel: GitDiffLine[] = []
  let pendingAdd: GitDiffLine[] = []

  const flush = (): void => {
    const count = Math.max(pendingDel.length, pendingAdd.length)
    for (let index = 0; index < count; index += 1) {
      rows.push({ left: pendingDel[index], right: pendingAdd[index] })
    }
    pendingDel = []
    pendingAdd = []
  }

  for (const line of lines) {
    if (line.type === 'del') {
      pendingDel.push(line)
      continue
    }
    if (line.type === 'add') {
      pendingAdd.push(line)
      continue
    }
    flush()
    // 上下文行左右同源，两边的行号都由同一个对象给出。
    rows.push({ left: line, right: line })
  }
  flush()
  return rows
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

/** 解析 `git diff` 输出，得到逐行配好对的差异块；二进制文件只回报标记。 */
export function parseUnifiedDiff(raw: string): { hunks: GitDiffHunk[]; binary: boolean } {
  const hunks: GitDiffHunk[] = []
  const lines = raw.split('\n')
  let binary = false
  let current: { header: string; lines: GitDiffLine[] } | undefined
  let oldNumber = 0
  let newNumber = 0

  const flush = (): void => {
    if (!current) return
    if (current.lines.length > 0) hunks.push({ header: current.header, rows: pairDiffLines(current.lines) })
    current = undefined
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const header = HUNK_HEADER.exec(line)
    if (header) {
      flush()
      oldNumber = Number(header[1])
      newNumber = Number(header[2])
      current = { header: line, lines: [] }
      continue
    }
    if (!current) {
      // 文件头里的 `Binary files ... differ` 说明这个文件没有行级差异。
      if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) binary = true
      continue
    }
    // 下一个文件的文件头，当前差异块到此结束。
    if (line.startsWith('diff --git ')) {
      flush()
      continue
    }
    if (line.startsWith('\\')) continue // `\ No newline at end of file`
    if (line.startsWith('+')) {
      current.lines.push({ newNumber, text: line.slice(1), type: 'add' })
      newNumber += 1
      continue
    }
    if (line.startsWith('-')) {
      current.lines.push({ oldNumber, text: line.slice(1), type: 'del' })
      oldNumber += 1
      continue
    }
    // 空行只在 diff 正文中出现时才是上下文行，末尾那一个是 split 的产物。
    if (line.startsWith(' ') || (line === '' && index < lines.length - 1)) {
      current.lines.push({ oldNumber, newNumber, text: line.slice(1), type: 'context' })
      oldNumber += 1
      newNumber += 1
    }
  }
  flush()
  return { hunks, binary }
}

/** 统计差异块里的行数，用于截断超大 diff。 */
function countDiffRows(hunks: GitDiffHunk[]): number {
  return hunks.reduce((total, hunk) => total + hunk.rows.length, 0)
}

/** 只保留前 maxRows 行，保证界面不会被超大 diff 拖垮。 */
function limitDiffRows(hunks: GitDiffHunk[], maxRows: number): { hunks: GitDiffHunk[]; truncated: boolean } {
  if (countDiffRows(hunks) <= maxRows) return { hunks, truncated: false }
  const limited: GitDiffHunk[] = []
  let remaining = maxRows
  for (const hunk of hunks) {
    if (remaining <= 0) break
    if (hunk.rows.length <= remaining) {
      limited.push(hunk)
      remaining -= hunk.rows.length
      continue
    }
    limited.push({ header: hunk.header, rows: hunk.rows.slice(0, remaining) })
    remaining = 0
  }
  return { hunks: limited, truncated: true }
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

/** 路径只允许相对仓库根目录，挡掉绝对路径与 `..` 逃逸。 */
function normalizeRelativePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return ''
  if (normalized.split('/').includes('..')) return ''
  return normalized
}

/** 读取工作区改动文件清单；非 Git 目录返回空清单。 */
export async function getGitChangeList(cwd: string): Promise<GitChangeList> {
  if (!cwd) return EMPTY_CHANGE_LIST

  let root = ''
  try {
    root = (await runGit(cwd, ['rev-parse', '--show-toplevel'], { readOnly: true })).trim()
  } catch {
    return EMPTY_CHANGE_LIST
  }
  if (!root) return EMPTY_CHANGE_LIST

  // -uall 把未跟踪目录展开成单个文件，文件树才能按目录分组。
  const porcelain = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { readOnly: true }).catch(() => '')
  const files = parseStatusFiles(porcelain)
  return {
    isRepository: true,
    root,
    files: files.slice(0, CHANGE_LIST_MAX_FILES),
    truncated: files.length > CHANGE_LIST_MAX_FILES
  }
}

/** 未跟踪文件不在 git diff 里，直接按「整份内容都是新增」生成对比。 */
async function readUntrackedFileDiff(root: string, path: string, kind: GitChangeKind): Promise<GitFileDiff> {
  const result: GitFileDiff = { path, kind, binary: false, truncated: false, hunks: [] }
  let buffer: Buffer
  try {
    const info = await stat(join(root, path))
    if (!info.isFile()) return result
    if (info.size > DIFF_MAX_FILE_BYTES) {
      result.truncated = true
      return result
    }
    buffer = await readFile(join(root, path))
  } catch {
    // 读取期间文件被删除或不可读，返回空对比即可。
    return result
  }
  if (isBinaryBuffer(buffer)) return { ...result, binary: true }

  const lines = splitFileLines(buffer.toString('utf8'))
  if (lines.length === 0) return result
  const rows = lines.map<GitDiffRow>((text, index) => ({ right: { newNumber: index + 1, text, type: 'add' } }))
  const limited = limitDiffRows([{ header: `@@ -0,0 +1,${lines.length} @@`, rows }], FILE_DIFF_MAX_ROWS)
  return { ...result, truncated: limited.truncated, hunks: limited.hunks }
}

/** 读取单个文件相对 HEAD 的行级对比，路径相对仓库根目录。 */
export async function getGitFileDiff(cwd: string, path: string): Promise<GitFileDiff> {
  const relative = normalizeRelativePath(path)
  const empty: GitFileDiff = { path: relative, kind: 'modified', binary: false, truncated: false, hunks: [] }
  if (!cwd || !relative) return empty

  let root = ''
  try {
    root = (await runGit(cwd, ['rev-parse', '--show-toplevel'], { readOnly: true })).trim()
  } catch {
    return empty
  }
  if (!root) return empty

  // 用 status 判断变更类型，并拿到重命名前的路径，让 diff 能在两个路径之间识别重命名。
  // 这里不能带 pathspec：只限定目标路径时 git 无法把重命名识别出来，会退化成新增。
  const porcelain = await runGit(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    readOnly: true
  }).catch(() => '')
  const entry = parseStatusFiles(porcelain).find((item) => item.path === relative)
  const kind = entry?.kind ?? 'modified'
  if (kind === 'untracked') return readUntrackedFileDiff(root, relative, kind)

  const paths = entry?.originalPath ? [entry.originalPath, relative] : [relative]
  const diffArgs = (base: string[]): string[] =>
    [...base, '-M', '--no-color', '--no-ext-diff', '--no-textconv', '--unified=3', '--', ...paths]

  let raw = ''
  const hasHead = await runGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], { readOnly: true })
    .then(() => true)
    .catch(() => false)
  if (hasHead) {
    raw = await runGit(root, diffArgs(['diff', 'HEAD']), { readOnly: true }).catch(() => '')
  } else {
    // 空仓库还没有 HEAD：暂存区对着空树，工作区对着暂存区。
    raw = await runGit(root, diffArgs(['diff', '--cached']), { readOnly: true }).catch(() => '')
    if (!raw) raw = await runGit(root, diffArgs(['diff']), { readOnly: true }).catch(() => '')
  }

  const parsed = parseUnifiedDiff(raw)
  const limited = limitDiffRows(parsed.hunks, FILE_DIFF_MAX_ROWS)
  return { path: relative, kind, binary: parsed.binary, truncated: limited.truncated, hunks: limited.hunks }
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
