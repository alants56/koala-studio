const { test } = require('node:test')
const assert = require('node:assert/strict')
const { mkdtemp, readFile, rm, stat } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { ConversationStore, conversationDirectoryName } = require('../src/shared/conversation-store.ts')

async function withStore(run) {
  const root = await mkdtemp(join(tmpdir(), 'koala-conversations-'))
  const store = new ConversationStore(join(root, 'conversations.json'), join(root, 'conversations'))
  try {
    await run(store, root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function exists(path) {
  return Boolean(await stat(path).catch(() => undefined))
}

test('对话目录名使用年月日时分秒', () => {
  assert.equal(conversationDirectoryName(new Date(2025, 8, 19, 14, 30, 12)), '20250919143012')
  assert.equal(conversationDirectoryName(new Date(2025, 0, 2, 3, 4, 5)), '20250102030405')
})

test('新建对话会创建时间戳目录并写入索引', async () => {
  await withStore(async (store, root) => {
    const conversation = await store.create(new Date(2025, 8, 19, 14, 30, 12))

    assert.equal(conversation.title, '新对话')
    assert.equal(conversation.sessionId, undefined)
    assert.equal(conversation.dir, join(root, 'conversations', '20250919143012'))
    assert.equal(await exists(conversation.dir), true)

    const persisted = JSON.parse(await readFile(join(root, 'conversations.json'), 'utf8'))
    assert.equal(persisted.length, 1)
    assert.equal(persisted[0].id, conversation.id)

    const list = await store.list()
    assert.deepEqual(list.map((item) => item.id), [conversation.id])
  })
})

test('同一秒内重复新建追加序号，不覆盖已有目录', async () => {
  await withStore(async (store, root) => {
    const at = new Date(2025, 8, 19, 14, 30, 12)
    const first = await store.create(at)
    const second = await store.create(at)

    assert.equal(first.dir, join(root, 'conversations', '20250919143012'))
    assert.equal(second.dir, join(root, 'conversations', '20250919143012-1'))
    assert.equal(await exists(first.dir), true)
    assert.equal(await exists(second.dir), true)
    assert.equal((await store.list()).length, 2)
  })
})

test('update 写入标题会话 id 并刷新时间；touch 只刷新时间', async () => {
  await withStore(async (store) => {
    const conversation = await store.create(new Date(2025, 8, 19, 14, 30, 12))
    const updated = await store.update(conversation.id, { title: '  排查  agt_cost  缺失错误 ', sessionId: ' session-1 ' })

    assert.equal(updated.title, '排查 agt_cost 缺失错误')
    assert.equal(updated.sessionId, 'session-1')
    assert.equal(updated.dir, conversation.dir)

    const touched = await store.touch(conversation.id)
    assert.equal(touched.title, updated.title)
    assert.equal(touched.sessionId, 'session-1')
    assert.ok(touched.updatedAt >= updated.updatedAt)
  })
})

test('update 忽略空标题，保留原标题', async () => {
  await withStore(async (store) => {
    const conversation = await store.create(new Date(2025, 8, 19, 14, 30, 12))
    await store.update(conversation.id, { title: '第一轮' })
    const updated = await store.update(conversation.id, { title: '   ' })
    assert.equal(updated.title, '第一轮')
  })
})

test('list 按最近使用倒序', async () => {
  await withStore(async (store) => {
    const older = await store.create(new Date(2025, 8, 19, 14, 30, 12))
    const newer = await store.create(new Date(2025, 8, 19, 14, 30, 13))

    assert.deepEqual((await store.list()).map((item) => item.id), [newer.id, older.id])

    await store.touch(older.id)
    assert.deepEqual((await store.list()).map((item) => item.id), [older.id, newer.id])
  })
})

test('删除对话只移除索引，目录与产物保留', async () => {
  await withStore(async (store) => {
    const conversation = await store.create(new Date(2025, 8, 19, 14, 30, 12))
    await store.delete(conversation.id)

    assert.deepEqual(await store.list(), [])
    assert.equal(await exists(conversation.dir), true)
    await assert.rejects(() => store.update(conversation.id, { title: 'x' }), /未找到对话/)
  })
})

test('归档只写标记，不改变标题与最近使用时间；取消归档移除标记', async () => {
  await withStore(async (store) => {
    const conversation = await store.create(new Date(2025, 8, 19, 14, 30, 12))
    await store.update(conversation.id, { title: '保留标题' })
    const before = (await store.list())[0]

    const archived = await store.setArchived(conversation.id, true)
    assert.equal(archived.title, '保留标题')
    assert.equal(archived.updatedAt, before.updatedAt)
    assert.ok(archived.archivedAt)

    const restored = await store.setArchived(conversation.id, false)
    assert.equal(restored.archivedAt, undefined)
    assert.equal(restored.title, '保留标题')
    assert.equal(restored.updatedAt, before.updatedAt)
  })
})
