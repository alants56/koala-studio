import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AutomationRunLogLevel } from '../../shared/automations'

const execFileAsync = promisify(execFile)

export interface AutomationExecutionResult {
  summary: string
  detail: string
  output: {
    title: string
    content: string
    format: 'markdown'
  }
}

async function git(projectPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: projectPath,
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 1024 * 1024
  })
  return stdout.trim()
}

/** Generates a local, deterministic brief without taking over the active agent session. */
export async function generateFeatureBrief(projectPath: string, log: (message: string, level?: AutomationRunLogLevel) => void = () => {}): Promise<AutomationExecutionResult> {
  const path = projectPath.trim()
  log('校验项目文件夹')
  if (!path) throw new Error('生成功能更新简报需要指定项目路径。')

  const insideWorkTree = await git(path, ['rev-parse', '--is-inside-work-tree'])
  if (insideWorkTree !== 'true') throw new Error('指定路径不是 Git 项目，无法生成更新简报。')
  log(`项目文件夹有效：${path}`, 'success')

  log('读取 Git 工作区状态、差异统计和最新提交')
  const [status, diffStat, latestCommit] = await Promise.all([
    git(path, ['status', '--short']),
    git(path, ['diff', '--stat']),
    git(path, ['log', '-1', '--pretty=format:%s'])
  ])
  log('Git 数据读取完成', 'success')
  const changes = status ? status.split('\n') : []
  const changed = changes.filter((line) => !line.startsWith('??')).length
  const untracked = changes.filter((line) => line.startsWith('??')).length
  const worktree = changes.length
    ? `当前有 ${changes.length} 项工作区变更（已跟踪 ${changed} 项，未跟踪 ${untracked} 项）。`
    : '当前工作区干净，没有未提交变更。'
  const diff = diffStat || '暂时没有可统计的已跟踪文件差异。'
  const commit = latestCommit || '暂无可读取的提交记录。'
  const generatedAt = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date())

  log('整理变更信息并生成简报')
  const content = `# 功能更新简报\n\n**生成时间：** ${generatedAt}\n\n**项目：** ${path}\n\n## 最新提交\n\n${commit}\n\n## 工作区状态\n\n${worktree}\n\n## 差异统计\n\n\`\`\`text\n${diff}\n\`\`\``
  log(`简报生成完成，共发现 ${changes.length} 项工作区变更`, 'success')

  return {
    summary: `已生成功能更新简报（${changes.length} 项工作区变更）`,
    detail: '简报已生成并保存到本次运行结果。',
    output: { title: '功能更新简报', content, format: 'markdown' }
  }
}
