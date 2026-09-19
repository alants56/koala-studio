const { test } = require('node:test')
const assert = require('node:assert/strict')
const {
  buildGitChangeTree,
  describeChangedLines,
  diffLineCounts
} = require('../src/renderer/src/utils/git-changes.ts')

function file(path, kind = 'modified') {
  return { path, kind, status: ' M' }
}

test('buildGitChangeTree groups files by folder', () => {
  const tree = buildGitChangeTree([
    file('README.md'),
    file('docs/architecture.md'),
    file('src/renderer/src/components/layout/ProjectNavigation.tsx'),
    file('src/renderer/src/pages/projects/ProjectChatPage.tsx'),
    file('src/shared/git.ts')
  ])

  assert.deepEqual(tree.files.map((item) => item.path), ['README.md'])
  assert.deepEqual(tree.folders.map((folder) => folder.name), ['docs', 'src'])
  assert.equal(tree.fileCount, 5)

  // 单一子目录链压成一行：src/renderer/src，和参考图一致。
  const src = tree.folders[1]
  assert.equal(src.fileCount, 3)
  assert.deepEqual(src.folders.map((folder) => folder.name), ['renderer/src', 'shared'])
  const renderer = src.folders[0]
  assert.deepEqual(renderer.folders.map((folder) => folder.name), ['components/layout', 'pages/projects'])
  assert.equal(renderer.folders[0].files[0].path, 'src/renderer/src/components/layout/ProjectNavigation.tsx')
  // 文件按路径排序，目录排在文件前面。
  assert.deepEqual(src.folders[1].files.map((item) => item.path), ['src/shared/git.ts'])
})

test('buildGitChangeTree keeps an empty tree for an empty list', () => {
  const tree = buildGitChangeTree([])
  assert.deepEqual(tree.folders, [])
  assert.deepEqual(tree.files, [])
  assert.equal(tree.fileCount, 0)
})

test('diffLineCounts counts added and deleted rows', () => {
  const diff = {
    path: 'a.txt',
    kind: 'modified',
    binary: false,
    truncated: false,
    hunks: [
      {
        header: '@@ -1,2 +1,3 @@',
        rows: [
          { left: { oldNumber: 1, newNumber: 1, text: 'keep', type: 'context' }, right: { oldNumber: 1, newNumber: 1, text: 'keep', type: 'context' } },
          { left: { oldNumber: 2, text: 'old', type: 'del' }, right: { newNumber: 2, text: 'new', type: 'add' } },
          { right: { newNumber: 3, text: 'extra', type: 'add' } }
        ]
      }
    ]
  }
  assert.deepEqual(diffLineCounts(diff), { additions: 2, deletions: 1 })
  assert.equal(describeChangedLines(diff), '新增 2-3 行 · 删除 2 行')
})

test('describeChangedLines collapses consecutive line numbers', () => {
  const rows = [116, 121, 122, 123, 130].map((number) => ({
    right: { newNumber: number, text: 'x', type: 'add' }
  }))
  const diff = { path: 'a.md', kind: 'modified', binary: false, truncated: false, hunks: [{ header: '@@', rows }] }
  assert.equal(describeChangedLines(diff), '新增 116、121-123、130 行')
})

test('describeChangedLines stays empty without line changes', () => {
  const diff = { path: 'a.md', kind: 'renamed', binary: false, truncated: false, hunks: [] }
  assert.equal(describeChangedLines(diff), '')
  assert.deepEqual(diffLineCounts(diff), { additions: 0, deletions: 0 })
})
