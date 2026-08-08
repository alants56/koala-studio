import type { Automation } from '../../shared/automations'
import { AutomationStore } from '../../shared/automation-store'
import { generateFeatureBrief, type AutomationExecutionResult } from './feature-brief'

export type AutomationExecutor = (automation: Automation) => Promise<AutomationExecutionResult>

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
      detail: 'Koala 创建任务时没有保存真实执行时间或项目文件夹。请重新创建该任务。', needsAttention: true
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
    try {
      const result = await this.executor(automation)
      await this.store.recordExecution(automation.id, { status: 'success', startedAt, durationMs: Date.now() - startedAt.getTime(), ...result })
    } catch (error) {
      const message = error instanceof Error ? error.message : '执行自动化时发生未知错误。'
      await this.store.recordExecution(automation.id, {
        status: 'failed', startedAt, durationMs: Date.now() - startedAt.getTime(), summary: '自动化执行失败', detail: message, needsAttention: true
      })
    } finally {
      this.running.delete(automation.id)
    }
  }
}

export async function executeScheduledAutomation(automation: Automation): Promise<AutomationExecutionResult> {
  if (automation.actionType === 'feature_brief') return generateFeatureBrief(automation.projectPath ?? '')
  throw new Error(`自动化「${automation.name}」没有可执行的计划动作。请选择“生成功能更新简报”。`)
}
