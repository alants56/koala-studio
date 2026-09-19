const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { SessionMetaStore } = require('../src/shared/session-meta-store.ts')

async function withStore(run) {
  const root = await mkdtemp(join(tmpdir(), 'koala-session-meta-'))
  const store = new SessionMetaStore(join(root, 'session-meta.json'))
  try {
    await run(store, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const session = (sessionId, title = 'Agent 标题', extra = {}) => ({
  sessionId,
  title,
  updatedAt: '2025-09-19T14:30:12.000Z',
  cwd: '/work/project',
  ...extra
})

test('rename 写自定义标题，apply 合并覆盖 Agent 标题', async () => {
  await withStore(async (store) => {
    await store.rename('claude', '/work/project', 's1', '  修复  登录  问题 ')
    const [merged] = await store.apply('claude', '/work/project', [session('s1')])

    assert.equal(merged.title, '修复 登录 问题')
    assert.equal(merged.titleFromUser, true)
    assert.equal(merged.archived, false)
  })
})

test('rename 空白标题清除自定义标题，回退 Agent 标题', async () => {
  await withStore(async (store, root) => {
    await store.rename('claude', '/work/project', 's1', '自定义')
    await store.rename('claude', '/work/project', 's1', '   ')
    const [merged] = await store.apply('claude', '/work/project', [session('s1')])

    assert.equal(merged.title, 'Agent 标题')
    assert.equal(merged.titleFromUser, false)
    // 标题清空且没有归档标记：索引里不留空记录。
    const persisted = JSON.parse(await readFile(join(root, 'session-meta.json'), 'utf8'))
    assert.deepEqual(persisted, {})
  })
})

test('归档标记持久化，取消归档后移除', async () => {
  const root = await mkdtemp(join(tmpdir(), 'koala-session-meta-'))
  try {
    const file = join(root, 'session-meta.json')
    const first = new SessionMetaStore(file)
    await first.rename('pi', '/work/project', 's1', '保留标题')
    await first.setArchived('pi', '/work/project', 's1', true)

    // 新实例从磁盘读取，验证落盘。
    const second = new SessionMetaStore(file)
    const [archived] = await second.apply('pi', '/work/project', [session('s1')])
    assert.equal(archived.archived, true)
    assert.equal(archived.title, '保留标题')

    await second.setArchived('pi', '/work/project', 's1', false)
    const [restored] = await second.apply('pi', '/work/project', [session('s1')])
    assert.equal(restored.archived, false)
    assert.equal(restored.title, '保留标题')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('同一 sessionId 在不同 Agent / 目录下互不影响', async () => {
  await withStore(async (store) => {
    await store.rename('claude', '/work/a', 's1', '甲')
    const [sameAgentOtherCwd] = await store.apply('claude', '/work/b', [session('s1')])
    const [otherAgent] = await store.apply('pi', '/work/a', [session('s1')])
    const [target] = await store.apply('claude', '/work/a', [session('s1')])

    assert.equal(sameAgentOtherCwd.title, 'Agent 标题')
    assert.equal(otherAgent.title, 'Agent 标题')
    assert.equal(target.title, '甲')
  })
})

test('forget 在会话被删除后清掉本地覆写，不留悬空条目', async () => {
  await withStore(async (store, root) => {
    await store.rename('claude', '/work/project', 's1', '自定义')
    await store.setArchived('claude', '/work/project', 's1', true)

    await store.forget('claude', '/work/project', 's1')
    const [merged] = await store.apply('claude', '/work/project', [session('s1')])
    assert.equal(merged.title, 'Agent 标题')
    assert.equal(merged.archived, false)

    const persisted = JSON.parse(await readFile(join(root, 'session-meta.json'), 'utf8'))
    assert.deepEqual(persisted, {})
  })
})

test('归档时记录标题快照，listArchived 完全本地返回归档列表', async () => {
  const root = await mkdtemp(join(tmpdir(), 'koala-session-meta-'))
  try {
    const file = join(root, 'session-meta.json')
    const first = new SessionMetaStore(file)
    await first.setArchived('claude', '/work/project', 's1', true, '第一次会话')
    await first.setArchived('claude', '/work/project', 's2', true, '第二次会话')
    await first.setArchived('pi', '/work/project', 's3', true, '别的 Agent')

    // 新实例从磁盘读取：归档列表不依赖 Agent，只读本地索引。
    const second = new SessionMetaStore(file)
    const archived = await second.listArchived('claude')
    assert.deepEqual(archived.map((entry) => entry.sessionId).sort(), ['s1', 's2'])
    assert.equal(archived.find((entry) => entry.sessionId === 's1').title, '第一次会话')
    assert.ok(archived.every((entry) => entry.archivedAt))

    // 取消归档后从列表移除，快照与归档时间一并清除。
    await second.setArchived('claude', '/work/project', 's1', false)
    assert.deepEqual((await second.listArchived('claude')).map((entry) => entry.sessionId), ['s2'])
    const persisted = JSON.parse(await readFile(file, 'utf8'))
    const restored = persisted['claude\u0000/work/project\u0000s1']
    assert.equal(restored, undefined)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('snapshotArchivedTitles 给老归档补标题快照，且不覆盖用户自定义标题', async () => {
  await withStore(async (store) => {
    // 老数据：归档时没有标题快照。
    await store.setArchived('claude', '/work', 'legacy', true)
    await store.rename('claude', '/work', 'renamed', '我的标题')
    await store.setArchived('claude', '/work', 'renamed', true)

    await store.snapshotArchivedTitles('claude', '/work', [
      session('legacy', 'Agent 标题'),
      session('renamed', 'Agent 标题')
    ])

    const archived = await store.listArchived('claude')
    assert.equal(archived.find((entry) => entry.sessionId === 'legacy').title, 'Agent 标题')
    assert.equal(archived.find((entry) => entry.sessionId === 'renamed').title, '我的标题')
  })
})
