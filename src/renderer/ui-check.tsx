import { createRoot } from 'react-dom/client'
import { App as AntdApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import './src/styles.css'
import type { GitApi } from '@shared/git'
// 真实仓库的改动数据（由 .ui-check/dump.cjs 生成），用于检查极端数据下的弹窗布局。
import mock from '../../.ui-check/mock.json'
import { GitChangesDialog } from './src/components/chat/GitChangesDialog'

window.git = {
  status: async () => ({
    isRepository: true,
    worktree: '/mock/repo',
    repoName: 'koala-studio',
    branch: 'main',
    detached: false,
    branches: [{ name: 'main', current: true, ahead: 0, behind: 0 }],
    changedFiles: mock.list.files.length,
    changes: { staged: 0, unstaged: 18, untracked: 6 }
  }),
  diff: async () => mock.summary,
  changes: async () => mock.list,
  fileDiff: async (_cwd: string, path: string) => mock.diffs[path as keyof typeof mock.diffs],
  checkout: async () => window.git.status(''),
  createBranch: async () => window.git.status(''),
  commit: async () => ({ hash: 'abc1234', status: await window.git.status(''), diff: mock.summary }),
  generateCommitMessage: async () => '更新'
} as unknown as GitApi

createRoot(document.getElementById('root')!).render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: '#18181b',
        fontSize: 13,
        fontFamily: '"Koala Numerals", "Koala Serif", serif'
      }
    }}
  >
    <AntdApp>
      <GitChangesDialog cwd="/mock/repo" open onClose={() => undefined} />
    </AntdApp>
  </ConfigProvider>
)
