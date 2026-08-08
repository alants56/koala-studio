import type { Automation, AutomationRunLog, AutomationRunLogLevel } from '../../shared/automations'
import { AutomationStore } from '../../shared/automation-store'
import { executeClaudeInstruction } from './claude-automation-executor'
import { generateFeatureBrief, type AutomationExecutionResult } from './feature-brief'
import { getTodoStore } from './todo-store'

export type AutomationExecutor = (automation: Automation, log: (message: string, level?: AutomationRunLogLevel) => void) => Promise<AutomationExecutionResult>

export class AutomationScheduler {
  private interval?: NodeJS.Timeout
  private readonly running = new Set<string>()

  constructor(
    private readonly store: AutomationStore,
    private readonly executor: AutomationExecutor,
    private readonly intervalMs = 15_000
  ) {}

  start(): void {
    if (this.interval) return
    void this.check().catch((error: unknown) => console.error('自动化调度检查失败：', error))
    this.interval = setInterval(() => void this.check().catch((error: unknown) => console.error('自动化调度检查失败：', error)), this.intervalMs)
  }

  stop(): void {
    if (!this.interval) return
    clearInterval(this.interval)
    this.interval = undefined
  }

  async check(now = new Date()): Promise<void> {
    const active: Automation[] = []
    let offset = 0
    do {
      const page = await this.store.list({ state: 'active', limit: 100, offset })
      active.push(...page.items)
      if (!page.hasMore) break
      offset = page.nextOffset ?? offset + page.count
    } while (true)

    const incomplete = active.filter((automation) => automation.trigger.trim() === '指定时间' && !automation.schedule)
    await Promise.all(incomplete.map((automation) => this.store.recordExecution(automation.id, {
      status: 'failed', startedAt: now, durationMs: 0, summary: '定时任务配置不完整',
      detail: 'Koala 创建任务时没有保存真实执行时间或项目文件夹。请重新创建该任务。', needsAttention: true,
      logs: [
        { at: now.toISOString(), level: 'info', message: '调度器检查到任务已到达指定时间' },
        { at: now.toISOString(), level: 'error', message: '缺少真实执行时间或项目文件夹，任务未执行' }
      ]
    })))

    const due = active.filter((automation) => {
      const nextRunAt = automation.schedule?.nextRunAt
      return Boolean(nextRunAt && new Date(nextRunAt) <= now)
    })
    await Promise.all(due.map((automation) => this.run(automation)))
  }

  private async run(automation: Automation): Promise<void> {
    if (this.running.has(automation.id)) return
    this.running.add(automation.id)
    const startedAt = new Date()
    const logs: AutomationRunLog[] = []
    const log = (message: string, level: AutomationRunLogLevel = 'info'): void => {
      logs.push({ at: new Date().toISOString(), level, message })
    }
    log('任务到期，调度器开始执行')
    log(`准备执行：${automation.action}`)
    try {
      const result = await this.executor(automation, log)
      log('执行完成，运行结果已保存', 'success')
      await this.store.recordExecution(automation.id, { status: 'success', startedAt, durationMs: Date.now() - startedAt.getTime(), logs, ...result })
    } catch (error) {
      const message = error instanceof Error ? error.message : '执行自动化时发生未知错误。'
      log(`执行失败：${message}`, 'error')
      await this.store.recordExecution(automation.id, {
        status: 'failed', startedAt, durationMs: Date.now() - startedAt.getTime(), summary: '自动化执行失败', detail: message, logs, needsAttention: true
      })
    } finally {
      this.running.delete(automation.id)
    }
  }
}

export async function executeScheduledAutomation(automation: Automation, log: (message: string, level?: AutomationRunLogLevel) => void): Promise<AutomationExecutionResult> {
  if (automation.actionType === 'feature_brief') return generateFeatureBrief(automation.projectPath ?? '', log)
  if (automation.actionType === 'claude_prompt') return executeClaudeInstruction(automation, log)
  if (automation.actionType === 'create_high_priority_todo') {
    const todo = await getTodoStore().create({ title: automation.name, important: true })
    log(`已创建高优先级待办：${todo.title}`, 'success')
    return {
      summary: '已创建高优先级待办',
      detail: `待办「${todo.title}」已添加到工作台。`,
      output: { title: '高优先级待办已创建', content: todo.title, format: 'text' }
    }
  }
  throw new Error(`自动化「${automation.name}」没有可执行的计划动作。`)
}
