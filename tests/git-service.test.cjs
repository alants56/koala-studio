const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { basename, join } = require('node:path')
const { execFile, execFileSync } = require('node:child_process')
const { promisify } = require('node:util')
const {
  checkoutGitBranch,
  commitGitChanges,
  countBufferLines,
  countChangedFiles,
  createGitBranch,
  getGitDiffSummary,
  getGitStatus,
  parseBranchList,
  parseNumstat,
  parsePorcelain
} = require('../src/main/services/git-service.ts')
const { buildCommitContext, sanitizeCommitMessage } = require('../src/main/services/git-commit-message.ts')

const EMPTY_DIFF = { additions: 0, deletions: 0, untracked: 0, binary: 0, truncated: false }
const NO_CHANGES = { staged: 0, unstaged: 0, untracked: 0 }

const execFileAsync = promisify(execFile)

function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

async function git(cwd, args) {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout
}

async function makeRepository(name) {
  const dir = await mkdtemp(join(tmpdir(), `koala-git-${name}-`))
  await git(dir, ['init', '-q'])
  await git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await git(dir, ['config', 'user.email', 'test@example.com'])
  await git(dir, ['config', 'user.name', 'Koala Test'])
  // commitGitChanges 走用户自己的配置，测试里显式关掉签名，避免受全局配置影响。
  await git(dir, ['config', 'commit.gpgsign', 'false'])
  await writeFile(join(dir, 'a.txt'), 'hello\n')
  await git(dir, ['add', '.'])
  await git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init'])
  return dir
}

test('countChangedFiles counts each porcelain entry once', () => {
  assert.equal(countChangedFiles(''), 0)
  assert.equal(countChangedFiles(' M a.txt\0?? b.txt\0'), 2)
  // 重命名条目会附带原始路径字段，不能重复计数。
  assert.equal(countChangedFiles('R  b.txt\0a.txt\0 M c.txt\0'), 2)
  assert.equal(countChangedFiles('C   copy.txt\0source.txt\0'), 1)
})

test('parseBranchList reads name, HEAD flag, upstream and tracking', () => {
  const branches = parseBranchList(['main\t*\torigin/main\tahead 2, behind 1', 'feature\t\t\t', 'dev\t\torigin/dev\tgone'].join('\n'))
  assert.deepEqual(branches, [
    { name: 'main', current: true, upstream: 'origin/main', ahead: 2, behind: 1 },
    { name: 'feature', current: false, upstream: undefined, ahead: 0, behind: 0 },
    { name: 'dev', current: false, upstream: 'origin/dev', ahead: 0, behind: 0 }
  ])
})

test('parseNumstat sums line counts and separates binary files', () => {
  assert.deepEqual(parseNumstat(''), { additions: 0, deletions: 0, binary: 0 })
  assert.deepEqual(parseNumstat('12\t3\ta.txt\n0\t5\tb.txt\n'), { additions: 12, deletions: 8, binary: 0 })
  // 二进制文件的行数是 `-`，不能当成数字累加。
  assert.deepEqual(parseNumstat('-\t-\tlogo.png\n7\t0\tc.txt\n'), { additions: 7, deletions: 0, binary: 1 })
  // 重命名条目照常计入行数。
  assert.deepEqual(parseNumstat('2\t1\ta.txt => b.txt\n'), { additions: 2, deletions: 1, binary: 0 })
})

test('parsePorcelain splits staged, unstaged and untracked', () => {
  assert.deepEqual(parsePorcelain(''), NO_CHANGES)
  // X 列是暂存区状态，Y 列是工作区状态。
  assert.deepEqual(parsePorcelain('M  a.txt\0'), { staged: 1, unstaged: 0, untracked: 0 })
  assert.deepEqual(parsePorcelain(' M a.txt\0'), { staged: 0, unstaged: 1, untracked: 0 })
  assert.deepEqual(parsePorcelain('MM a.txt\0'), { staged: 1, unstaged: 1, untracked: 0 })
  assert.deepEqual(parsePorcelain('?? new.txt\0'), { staged: 0, unstaged: 0, untracked: 1 })
  assert.deepEqual(parsePorcelain('A  a.txt\0?? b.txt\0 M c.txt\0'), { staged: 1, unstaged: 1, untracked: 1 })
  // 重命名条目带一个额外的原始路径字段，不能把它当成第二个文件。
  assert.deepEqual(parsePorcelain('R  b.txt\0a.txt\0'), { staged: 1, unstaged: 0, untracked: 0 })
})

test('sanitizeCommitMessage reduces a model reply to one clean subject', () => {
  assert.equal(sanitizeCommitMessage('修复登录超时'), '修复登录超时')
  // 代码围栏
  assert.equal(sanitizeCommitMessage('```\n修复登录超时\n```'), '修复登录超时')
  assert.equal(sanitizeCommitMessage('```text\n修复登录超时\n```'), '修复登录超时')
  // 常见前缀与项目符号
  assert.equal(sanitizeCommitMessage('提交说明：修复登录超时'), '修复登录超时')
  assert.equal(sanitizeCommitMessage('Commit: fix login timeout'), 'fix login timeout')
  assert.equal(sanitizeCommitMessage('- 修复登录超时'), '修复登录超时')
  assert.equal(sanitizeCommitMessage('1. 修复登录超时'), '修复登录超时')
  // 包裹引号与句末句号
  assert.equal(sanitizeCommitMessage('“修复登录超时”'), '修复登录超时')
  assert.equal(sanitizeCommitMessage('修复登录超时。'), '修复登录超时')
  // 多行只取第一行有效内容
  assert.equal(sanitizeCommitMessage('\n\n修复登录超时\n\n补充说明：巴拉巴拉'), '修复登录超时')
  // 超长截断
  assert.equal(sanitizeCommitMessage('长'.repeat(300)).length, 200)
  assert.equal(sanitizeCommitMessage('   '), '')
})

test('countBufferLines counts a final line without a trailing newline', () => {
  assert.equal(countBufferLines(Buffer.from('')), 0)
  assert.equal(countBufferLines(Buffer.from('a\nb\n')), 2)
  assert.equal(countBufferLines(Buffer.from('a\nb')), 2)
  assert.equal(countBufferLines(Buffer.from('a\n\n')), 2)
})

test('non-repository directories report no git repository', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koala-nogit-'))
  const status = await getGitStatus(dir)
  assert.equal(status.isRepository, false)
  assert.deepEqual(status.branches, [])
  assert.equal(status.changedFiles, 0)
  assert.equal((await getGitStatus('')).isRepository, false)
  assert.equal((await getGitStatus(join(dir, 'missing'))).isRepository, false)
})

test('reads local branches and uncommitted file count', { skip: !hasGit() }, async () => {
  const dir = await makeRepository('status')
  const initial = await getGitStatus(dir)
  assert.equal(initial.isRepository, true)
  assert.equal(initial.branch, 'main')
  assert.equal(initial.repoName, basename(dir))
  assert.equal(initial.detached, false)
  assert.equal(initial.changedFiles, 0)
  assert.deepEqual(initial.branches.map((branch) => branch.name), ['main'])
  assert.equal(initial.branches[0].current, true)

  await writeFile(join(dir, 'a.txt'), 'changed\n')
  await writeFile(join(dir, 'untracked.txt'), 'new\n')
  const dirty = await getGitStatus(dir)
  assert.equal(dirty.changedFiles, 2)
})

test('switches branches and creates a new branch', { skip: !hasGit() }, async () => {
  const dir = await makeRepository('switch')
  await writeFile(join(dir, 'a.txt'), 'on-main\n')
  await git(dir, ['-c', 'commit.gpgsign=false', 'commit', '-q', '-am', 'main work'])

  const created = await createGitBranch(dir, 'feature/login')
  assert.equal(created.branch, 'feature/login')
  assert.equal(created.branches.find((branch) => branch.name === 'feature/login').current, true)
  assert.equal(created.branches.find((branch) => branch.name === 'main').current, false)

  const switched = await checkoutGitBranch(dir, 'main')
  assert.equal(switched.branch, 'main')
  assert.equal(switched.branches.find((branch) => branch.name === 'main').current, true)

  // 中文 locale 下 git 会输出「路径规格 ... 未匹配」，英文 locale 是 "did not match"。
  await assert.rejects(() => checkoutGitBranch(dir, 'missing-branch'), /did not match|pathspec|不存在|未知|未匹配/)
  await assert.rejects(() => createGitBranch(dir, 'main'), /already exists|已经存在/i)
  await assert.rejects(() => createGitBranch(dir, 'bad name'), /不合法/)
  await assert.rejects(() => checkoutGitBranch(dir, '  '), /分支名不能为空/)
})

test('summarizes tracked and untracked changes', { skip: !hasGit() }, async () => {
  const dir = await makeRepository('diff')
  await writeFile(join(dir, 'a.txt'), 'hello\nworld\n')
  await writeFile(join(dir, 'new.txt'), 'one\ntwo\nthree\n')

  const summary = await getGitDiffSummary(dir)
  // a.txt 新增 1 行，未跟踪的 new.txt 按全文计入 3 行。
  assert.deepEqual(summary, { additions: 4, deletions: 0, untracked: 1, binary: 0, truncated: false })

  await writeFile(join(dir, 'a.txt'), '')
  assert.equal((await getGitDiffSummary(dir)).deletions, 1)
})

test('counts binary files without line numbers', { skip: !hasGit() }, async () => {
  const dir = await makeRepository('binary')
  await writeFile(join(dir, 'logo.bin'), Buffer.from([0x00, 0x01, 0x02, 0x0a]))

  const summary = await getGitDiffSummary(dir)
  assert.equal(summary.binary, 1)
  assert.equal(summary.additions, 0)
  assert.equal(summary.untracked, 1)
})

test('non-repository directories report an empty diff summary', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koala-nodiff-'))
  assert.deepEqual(await getGitDiffSummary(dir), EMPTY_DIFF)
  assert.deepEqual(await getGitDiffSummary(''), EMPTY_DIFF)
})

test('summarizes a repository that has no commit yet', { skip: !hasGit() }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koala-unborn-'))
  await git(dir, ['init', '-q'])
  await writeFile(join(dir, 'a.txt'), 'first\nsecond\n')

  // 没有 HEAD 时退回暂存区与空树的差异。
  assert.equal((await getGitDiffSummary(dir)).untracked, 1)
  await git(dir, ['add', '-A'])
  assert.equal((await getGitDiffSummary(dir)).additions, 2)
})

test('commits every change and reports the new commit', { skip: !hasGit() }, async () => {
  const dir = await makeRepository('commit')
  await writeFile(join(dir, 'a.txt'), 'hello\nworld\n')
  await writeFile(join(dir, 'untracked.txt'), 'new\n')

  const result = await commitGitChanges(dir, '更新 2 个文件')
  assert.match(result.hash, /^[0-9a-f]{7,}$/)
  assert.equal(result.status.changedFiles, 0)
  assert.deepEqual(result.diff, EMPTY_DIFF)
  assert.equal((await git(dir, ['log', '-1', '--format=%s'])).trim(), '更新 2 个文件')
  // 未跟踪文件也要一起提交。
  assert.match(await git(dir, ['show', '--name-only', '--format=', 'HEAD']), /untracked\.txt/)
})

test('reports staged and unstaged counts from a real worktree', { skip: !hasGit() }, async () => {
  const dir = await makeRepository('counts')
  await writeFile(join(dir, 'a.txt'), 'changed\n')
  await writeFile(join(dir, 'untracked.txt'), 'new\n')
  assert.deepEqual((await getGitStatus(dir)).changes, { staged: 0, unstaged: 1, untracked: 1 })

  await git(dir, ['add', 'a.txt'])
  assert.deepEqual((await getGitStatus(dir)).changes, { staged: 1, unstaged: 0, untracked: 1 })
})

test('commits only the index when unstaged changes are excluded', { skip: !hasGit() }, async () => {
  const dir = await makeRepository('staged-only')
  await writeFile(join(dir, 'a.txt'), 'staged change\n')
  await git(dir, ['add', 'a.txt'])
  // 暂存之后再次改动 a.txt：此刻它是 MM，暂存区与工作区各有一份内容。
  await writeFile(join(dir, 'a.txt'), 'staged change\nunstaged tail\n')
  // 从未 add 过的文件算未跟踪，不属于「未暂存的改动」。
  await writeFile(join(dir, 'untracked.txt'), 'new\n')
  assert.deepEqual((await getGitStatus(dir)).changes, { staged: 1, unstaged: 1, untracked: 1 })

  const result = await commitGitChanges(dir, '只提交暂存内容', { includeUnstaged: false })
  assert.match(result.hash, /^[0-9a-f]{7,}$/)
  assert.equal((await git(dir, ['show', '--name-only', '--format=', 'HEAD'])).trim(), 'a.txt')
  // 提交进去的是暂存那一刻的内容，不含之后写进工作区的那一行。
  assert.equal(await git(dir, ['show', 'HEAD:a.txt']), 'staged change\n')
  // 未暂存的改动与未跟踪文件都留在工作区。
  assert.equal(result.status.changes.unstaged, 1)
  assert.equal(result.status.changes.untracked, 1)
  assert.equal(result.status.changes.staged, 0)

  await assert.rejects(
    () => commitGitChanges(dir, '再来一次', { includeUnstaged: false }),
    /没有已暂存的改动/
  )
})

test('buildCommitContext keeps non-ASCII paths readable', { skip: !hasGit() }, async () => {
  const dir = await makeRepository('context')
  await writeFile(join(dir, '中文说明.md'), '内容\n')
  await writeFile(join(dir, '未跟踪.txt'), '新文件\n')

  const context = await buildCommitContext(dir)
  // 回归：默认 core.quotepath 会把中文转义成 \344\270\255，喂给模型就是乱码。
  assert.ok(context.includes('中文说明.md'), `期望包含原始中文文件名，实际：${context.slice(0, 400)}`)
  assert.ok(!context.includes('\\344'), '中文文件名不应被八进制转义')
  // 未跟踪文件不在 diff 里，必须单独列出。
  assert.ok(context.includes('未跟踪.txt'))
})

test('buildCommitContext truncates an oversized patch', { skip: !hasGit() }, async () => {
  const dir = await makeRepository('truncate')
  await writeFile(join(dir, 'big.txt'), `${'新增内容行\n'.repeat(3000)}`)
  await git(dir, ['add', 'big.txt'])

  const context = await buildCommitContext(dir)
  assert.ok(context.includes('补丁过长，已截断'))
  // 截断后的正文不应远超上限（含 stat 概览与提示语）。
  assert.ok(context.length < 16_000, `上下文过长：${context.length}`)
})

test('refuses empty commit messages and clean worktrees', { skip: !hasGit() }, async () => {
  const dir = await makeRepository('commit-guard')
  await assert.rejects(() => commitGitChanges(dir, '   '), /提交说明不能为空/)
  await assert.rejects(() => commitGitChanges(dir, 'nothing to do'), /没有需要提交的改动/)

  await writeFile(join(dir, 'a.txt'), 'hello\nworld\n')
  await commitGitChanges(dir, 'first')
  await assert.rejects(() => commitGitChanges(dir, 'second'), /没有需要提交的改动/)
})
