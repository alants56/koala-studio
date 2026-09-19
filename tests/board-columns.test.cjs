const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  DEFAULT_COLUMNS,
  boardFromTodos,
  moveTodoInBoard,
  parseBoardColumns
} = require('../src/renderer/src/components/board/board-columns.ts')

const COLUMNS = [
  { id: 'a', title: '待处理' },
  { id: 'b', title: '进行中' }
]

let seq = 0
function todo(overrides) {
  seq += 1
  return {
    id: `t${seq}`,
    title: `待办 ${seq}`,
    done: false,
    important: false,
    columnId: 'a',
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

test('parseBoardColumns 保留合法列、去重并 trim', () => {
  const parsed = parseBoardColumns([
    { id: ' backlog ', title: ' 待处理 ' },
    { id: 'backlog', title: '重复 id 应被丢弃' },
    { id: 'done', title: '已完成' }
  ])
  assert.deepEqual(parsed, [
    { id: 'backlog', title: '待处理' },
    { id: 'done', title: '已完成' }
  ])
})

test('parseBoardColumns 丢弃缺字段的项，全空时回退默认列', () => {
  assert.deepEqual(parseBoardColumns([{ id: 'x' }, { title: '没有 id' }, null, 'nope']), DEFAULT_COLUMNS)
  assert.deepEqual(parseBoardColumns([]), DEFAULT_COLUMNS)
  assert.deepEqual(parseBoardColumns('not-an-array'), DEFAULT_COLUMNS)
  assert.deepEqual(parseBoardColumns(null), DEFAULT_COLUMNS)
})

test('boardFromTodos 按列分组，并按 position 排序', () => {
  const late = todo({ id: 'late', columnId: 'a', position: 2, createdAt: '2026-01-01T00:00:00.000Z' })
  const early = todo({ id: 'early', columnId: 'a', position: 0, createdAt: '2026-01-02T00:00:00.000Z' })
  const mid = todo({ id: 'mid', columnId: 'a', position: 1, createdAt: '2026-01-01T00:00:00.000Z' })
  const other = todo({ id: 'other', columnId: 'b', position: 0 })

  const board = boardFromTodos([late, early, mid, other], COLUMNS)

  assert.deepEqual(board.a.map((item) => item.id), ['early', 'mid', 'late'])
  assert.deepEqual(board.b.map((item) => item.id), ['other'])
})

test('boardFromTodos 把未知 columnId 的待办归入第一列', () => {
  // Agent 经 MCP 建待办时用的是默认 columnId，在改过列的项目里对不上任何一列。
  // 修复前这类待办会分到一个永远不渲染的桶里，在看板上直接消失。
  const orphan = todo({ id: 'orphan', columnId: 'backlog', position: 0 })
  const board = boardFromTodos([orphan], COLUMNS)

  assert.deepEqual(Object.keys(board), ['a', 'b'])
  assert.deepEqual(board.a.map((item) => item.id), ['orphan'])
  assert.deepEqual(board.b, [])
})

test('moveTodoInBoard 跨列移动后为所有列重新编号', () => {
  const first = todo({ id: 'first', columnId: 'a', position: 0 })
  const second = todo({ id: 'second', columnId: 'a', position: 1 })
  const third = todo({ id: 'third', columnId: 'b', position: 0 })

  const moved = moveTodoInBoard([first, second, third], COLUMNS, 'first', 'b')
  const byId = new Map(moved.map((item) => [item.id, item]))

  assert.deepEqual([byId.get('second').columnId, byId.get('second').position], ['a', 0])
  assert.deepEqual([byId.get('third').columnId, byId.get('third').position], ['b', 0])
  assert.deepEqual([byId.get('first').columnId, byId.get('first').position], ['b', 1])
})

test('moveTodoInBoard 支持插到指定待办之前', () => {
  const first = todo({ id: 'first', columnId: 'a', position: 0 })
  const second = todo({ id: 'second', columnId: 'a', position: 1 })
  const third = todo({ id: 'third', columnId: 'b', position: 0 })

  const moved = moveTodoInBoard([first, second, third], COLUMNS, 'third', 'a', 'first')
  const byId = new Map(moved.map((item) => [item.id, item]))

  assert.deepEqual([byId.get('third').columnId, byId.get('third').position], ['a', 0])
  assert.deepEqual([byId.get('first').columnId, byId.get('first').position], ['a', 1])
  assert.deepEqual([byId.get('second').columnId, byId.get('second').position], ['a', 2])
})

test('moveTodoInBoard 对未知列或未知待办原样返回', () => {
  const items = [todo({ id: 'only', columnId: 'a', position: 0 })]

  assert.equal(moveTodoInBoard(items, COLUMNS, 'only', 'nope'), items)
  assert.equal(moveTodoInBoard(items, COLUMNS, 'missing', 'b'), items)
})

test('moveTodoInBoard 把兜底列的待办写回真实列 id', () => {
  const orphan = todo({ id: 'orphan', columnId: 'backlog', position: 0 })

  const moved = moveTodoInBoard([orphan], COLUMNS, 'orphan', 'b')

  assert.deepEqual([moved[0].columnId, moved[0].position], ['b', 0])
})
