import type { ReactElement } from 'react'
import { Spin } from 'antd'
import type { GitFileDiff } from '@shared/git'
import { CHANGE_KIND_LABELS, describeChangedLines, diffLineCounts } from '@/utils/git-changes'

interface GitFileDiffViewProps {
  /** 当前选中文件的对比内容；未选中时为空。 */
  diff?: GitFileDiff
  loading: boolean
}

/** 按行类型决定左右两栏的着色 class。 */
function lineClass(type: 'context' | 'add' | 'del' | undefined): string {
  if (type === 'add') return ' is-add'
  if (type === 'del') return ' is-del'
  return ''
}

/**
 * 单文件对比区：左右两栏并排，各带行号栏，改动行整行着色。
 * 左右滚动交给外层容器，两个面板始终对齐。
 */
export function GitFileDiffView({ diff, loading }: GitFileDiffViewProps): ReactElement {
  if (!diff) {
    return (
      <div className="git-diff-placeholder">
        {loading ? <Spin size="small" /> : '从左侧选择一个文件，查看逐行改动'}
      </div>
    )
  }
  if (diff.binary) {
    return <div className="git-diff-placeholder">二进制文件，无法逐行对比</div>
  }
  if (diff.hunks.length === 0) {
    return <div className="git-diff-placeholder">这个文件没有可逐行对比的改动（可能只改了文件名或权限）</div>
  }

  const counts = diffLineCounts(diff)
  const changedLines = describeChangedLines(diff)

  return (
    <div className="git-diff-view">
      <div className="git-diff-toolbar">
        <span className="git-diff-file" title={diff.path}>{diff.path}</span>
        <span className={`git-change-tag is-${diff.kind}`}>{CHANGE_KIND_LABELS[diff.kind]}</span>
        <span className="git-diff-count">
          <span className="git-diff-add">+{counts.additions}</span>
          <span className="git-diff-del">−{counts.deletions}</span>
        </span>
      </div>
      {changedLines && <div className="git-diff-changed-lines" title={changedLines}>{changedLines}</div>}
      <div className="git-diff-scroll">
        <table className="git-diff-table">
          <thead>
            <tr>
              <th colSpan={2} className="git-diff-pane-head">修改前</th>
              <th colSpan={2} className="git-diff-pane-head is-new">修改后</th>
            </tr>
          </thead>
          <tbody>
            {diff.hunks.map((hunk, hunkIndex) => (
              // 差异块之间用 `@@` 头分隔，和 git diff 的阅读顺序一致。
              [
                <tr key={`hunk-${hunkIndex}`} className="git-diff-hunk">
                  <td colSpan={4}>{hunk.header}</td>
                </tr>,
                ...hunk.rows.map((row, rowIndex) => (
                  <tr key={`hunk-${hunkIndex}-row-${rowIndex}`}>
                    <td className={`git-diff-num${lineClass(row.left?.type)}`}>{row.left?.oldNumber ?? ''}</td>
                    <td className={`git-diff-code${lineClass(row.left?.type)}`}>{row.left?.text ?? ''}</td>
                    <td className={`git-diff-num is-new${lineClass(row.right?.type)}`}>{row.right?.newNumber ?? ''}</td>
                    <td className={`git-diff-code is-new${lineClass(row.right?.type)}`}>{row.right?.text ?? ''}</td>
                  </tr>
                ))
              ]
            ))}
          </tbody>
        </table>
      </div>
      {loading && (
        <div className="git-diff-refreshing" role="status" aria-live="polite">
          <Spin size="small" />
        </div>
      )}
      {diff.truncated && (
        <div className="git-diff-note">
          {diff.hunks.length === 0 ? '文件过大，未展开逐行对比' : '改动过多，仅显示前一部分内容'}
        </div>
      )}
    </div>
  )
}
