import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { Automation, AutomationRun, AutomationListInput, AutomationListResult, AutomationRunLog, AutomationRunOutput, CreateAutomationInput, UpdateAutomationInput } from './automations'

/** 旧版本首启时写入的演示数据（含伪造运行记录）；读取时若发现与种子完全一致的记录会自动清理。 */
const LEGACY_SEED_AUTOMATIONS: Automation[] = [
  { id: 'daily-brief', name: '每日项目简报', description: '汇总活跃项目的会话进度和待办，生成今天的工作摘要。', state: 'active', trigger: '每天 09:00', triggerDetail: '按计划触发', action: '生成并发送摘要', actionDetail: '通知中心', scope: '全部活跃项目', runs: [{ id: 'run-1', status: 'success', startedAt: '今天 09:00', duration: '14 秒', summary: '已汇总 3 个活跃项目', detail: '摘要已发送到通知中心。' }] },
  { id: 'review-failure', name: '失败运行提醒', description: '任何自动化任务失败时，立即创建一条需要处理的待办。', state: 'active', trigger: '运行失败时', triggerDetail: '事件触发', action: '创建高优先级待办', actionDetail: '工作台', scope: '全部自动化', runs: [{ id: 'run-2', status: 'success', startedAt: '昨天 18:42', duration: '1 秒', summary: '已处理 1 次失败事件', detail: '待办已关联到对应运行记录。' }] },
  { id: 'idle-project', name: '闲置项目跟进', description: '项目连续 7 天没有新消息时，提示确认下一步。', state: 'attention', trigger: '每天 17:30', triggerDetail: '按计划触发', action: '发送跟进提醒', actionDetail: '通知中心', scope: '全部项目', runs: [{ id: 'run-3', status: 'failed', startedAt: '昨天 17:30', duration: '3 秒', summary: '无法读取 1 个项目的会话状态', detail: '请检查该项目的 ACP 连接后重试。' }] },
  { id: 'new-project', name: '新项目初始化', description: '创建项目后自动准备协作上下文和首个待办。', state: 'paused', trigger: '创建项目时', triggerDetail: '事件触发', action: '创建协作清单', actionDetail: '项目工作台', scope: '新建项目', runs: [] }
]

const LEGACY_SEED_JSON = new Map(LEGACY_SEED_AUTOMATIONS.map((seed) => [seed.id, JSON.stringify(seed)]))

/** 只删除与种子内容完全一致的演示记录；用户编辑过的（内容不同）会保留。 */
function removeLegacySeeds(items: Automation[]): Automation[] {
  const next = items.filter((item) => LEGACY_SEED_JSON.get(item.id) !== JSON.stringify(item))
  return next.length === items.length ? items : next
}

function inferTriggerDetail(trigger: string): string {
  return trigger.includes('每天') || trigger.includes('每周') ? '按计划触发' : '事件触发'
}

function requiresProjectPath(actionType: Automation['actionType']): boolean {
  return actionType === 'feature_brief' || actionType === 'claude_prompt' || actionType === 'pi_prompt'
}

function requiresInstruction(actionType: Automation['actionType']): boolean {
  return actionType === 'claude_prompt' || actionType === 'pi_prompt'
}

export class AutomationStore {
  private cache?: Automation[]
  private cacheMtimeMs?: number

  constructor(private readonly file: string) {}

  private async readAll(): Promise<Automation[]> {
    try {
      const stats = await fs.stat(this.file)
      if (this.cache && this.cacheMtimeMs === stats.mtimeMs) return this.cache
      const raw = await fs.readFile(this.file, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      const items = Array.isArray(parsed) ? parsed as Automation[] : []
      const cleaned = removeLegacySeeds(items)
      this.cache = cleaned
      this.cacheMtimeMs = stats.mtimeMs
      if (cleaned !== items) await this.writeAll(cleaned)
    } catch {
      // 文件缺失或损坏时返回空列表，不覆盖磁盘上的既有内容。
      this.cache ??= []
      this.cacheMtimeMs = undefined
    }
    return this.cache
  }

  private async writeAll(items: Automation[]): Promise<void> {
    this.cache = items
    await fs.mkdir(dirname(this.file), { recursive: true })
    const temporaryFile = `${this.file}.${process.pid}.${randomUUID()}.tmp`
    await fs.writeFile(temporaryFile, JSON.stringify(items, null, 2), 'utf8')
    await fs.rename(temporaryFile, this.file)
    this.cacheMtimeMs = undefined
  }

  async list(input: AutomationListInput = {}): Promise<AutomationListResult> {
    const state = input.state
    const query = input.query?.trim().toLowerCase()
    const offset = Math.max(0, input.offset ?? 0)
    const limit = Math.min(100, Math.max(1, input.limit ?? 50))
    const matched = (await this.readAll()).filter((item) => {
      const searchable = `${item.name} ${item.description} ${item.trigger} ${item.action}`.toLowerCase()
      return (!state || item.state === state) && (!query || searchable.includes(query))
    })
    const items = matched.slice(offset, offset + limit)
    return { total: matched.length, count: items.length, offset, hasMore: offset + items.length < matched.length, ...(offset + items.length < matched.length ? { nextOffset: offset + items.length } : {}), items }
  }

  async get(id: string): Promise<Automation> {
    const automation = (await this.readAll()).find((item) => item.id === id)
    if (!automation) throw new Error(`未找到自动化「${id}」。请先调用 koala_list_automations 获取有效 ID。`)
    return automation
  }

  async create(input: CreateAutomationInput): Promise<Automation> {
    const name = input.name.trim()
    if (!name) throw new Error('自动化名称不能为空。')
    const schedule = input.schedule ? validateSchedule(input.schedule) : undefined
    if (input.enabled !== false && input.trigger.trim() === '指定时间' && !schedule) {
      throw new Error('启用指定时间任务必须提供 schedule、actionType 和 projectPath，不能只填写展示时间。')
    }
    if (schedule && !input.actionType) throw new Error('定时任务必须指定可执行动作。')
    if (schedule && requiresProjectPath(input.actionType) && !input.projectPath?.trim()) throw new Error('定时任务需要指定项目文件夹。')
    if (schedule && requiresInstruction(input.actionType) && !input.instruction?.trim()) throw new Error('该定时任务需要填写自定义指令。')
    const automation: Automation = {
      id: randomUUID(), name, description: input.description?.trim() || `${input.trigger}时，${input.action}。`,
      state: input.enabled === false ? 'paused' : 'active', trigger: input.trigger.trim(), triggerDetail: input.triggerDetail?.trim() || inferTriggerDetail(input.trigger),
      action: input.action.trim(), actionDetail: input.actionDetail?.trim() || '通知中心', scope: input.scope.trim(), runs: [],
      ...(schedule ? { schedule } : {}),
      ...(input.actionType ? { actionType: input.actionType } : {}),
      ...(input.projectPath?.trim() ? { projectPath: input.projectPath.trim() } : {}),
      ...(input.instruction?.trim() ? { instruction: input.instruction.trim() } : {})
    }
    const items = await this.readAll()
    await this.writeAll([automation, ...items])
    return automation
  }

  async update(id: string, input: UpdateAutomationInput): Promise<Automation> {
    const items = await this.readAll()
    const index = items.findIndex((item) => item.id === id)
    if (index === -1) throw new Error(`未找到自动化「${id}」。请先调用 koala_list_automations 获取有效 ID。`)
    const current = items[index]
    const changes = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
    const updated: Automation = { ...current, ...changes, ...(input.schedule ? { schedule: validateSchedule(input.schedule) } : {}) }
    if (input.schedule === null) delete updated.schedule
    if (input.projectPath === null) delete updated.projectPath
    if (input.instruction === null) delete updated.instruction
    if (!updated.name.trim()) throw new Error('自动化名称不能为空。')
    if (updated.state === 'active' && updated.trigger.trim() === '指定时间' && !updated.schedule) {
      throw new Error('启用指定时间任务必须提供完整的执行计划。')
    }
    if (updated.schedule && !updated.actionType) throw new Error('定时任务必须指定可执行动作。')
    if (updated.schedule && requiresProjectPath(updated.actionType) && !updated.projectPath?.trim()) throw new Error('定时任务需要指定项目文件夹。')
    if (updated.schedule && requiresInstruction(updated.actionType) && !updated.instruction?.trim()) throw new Error('该定时任务需要填写自定义指令。')
    items[index] = updated
    await this.writeAll(items)
    return updated
  }

  async setEnabled(id: string, enabled: boolean): Promise<Automation> {
    const automation = await this.get(id)
    if (enabled && automation.trigger.trim() === '指定时间' && !automation.schedule) {
      throw new Error('该任务缺少真实执行计划，请重新创建并选择执行时间和项目文件夹。')
    }
    if (enabled && automation.schedule && requiresProjectPath(automation.actionType) && !automation.projectPath?.trim()) throw new Error('该任务缺少项目文件夹。')
    if (enabled && automation.schedule && requiresInstruction(automation.actionType) && !automation.instruction?.trim()) {
      throw new Error('该任务缺少自定义指令。')
    }
    return this.replace({ ...automation, state: enabled ? 'active' : 'paused' })
  }

  /** 手动测试：只校验执行计划、动作配置和项目文件夹，不启动 Agent、不对外发送通知或写入项目数据。 */
  async runTest(id: string): Promise<Automation> {
    const automation = await this.get(id)
    const startedAt = new Date()
    const logs: AutomationRunLog[] = [{ at: startedAt.toISOString(), level: 'info', message: `开始测试自动化「${automation.name}」` }]
    let failureMessage: string | undefined
    const check = (ok: boolean, okMessage: string, failMessage: string): void => {
      logs.push({ at: new Date().toISOString(), level: ok ? 'info' : 'error', message: ok ? okMessage : failMessage })
      if (!ok && failureMessage === undefined) failureMessage = failMessage
    }

    if (automation.trigger.trim() === '指定时间') {
      check(Boolean(automation.schedule), `触发条件：${automation.trigger}`, '指定时间任务缺少执行计划，请编辑并选择执行时间。')
      if (automation.schedule) {
        check(!Number.isNaN(new Date(automation.schedule.nextRunAt).getTime()), `计划执行时间：${automation.schedule.nextRunAt}`, '计划执行时间无效。')
        check(Boolean(automation.actionType), `执行动作：${automation.action}`, '定时任务缺少可执行的动作类型。')
        if (requiresProjectPath(automation.actionType)) {
          check(Boolean(automation.projectPath?.trim()), '已配置项目文件夹。', '定时任务缺少项目文件夹。')
        }
        if (requiresInstruction(automation.actionType)) {
          check(Boolean(automation.instruction?.trim()), '已配置自定义指令。', '定时任务缺少自定义指令。')
        }
      }
    } else {
      logs.push({ at: new Date().toISOString(), level: 'info', message: `触发条件「${automation.trigger}」未配置执行计划，本次仅校验基础字段。` })
    }
    if (automation.projectPath?.trim()) {
      let directoryExists = false
      try {
        directoryExists = (await fs.stat(automation.projectPath)).isDirectory()
      } catch {
        directoryExists = false
      }
      check(directoryExists, `项目文件夹存在：${automation.projectPath}`, `项目文件夹不存在或不可访问：${automation.projectPath}`)
    }

    const success = failureMessage === undefined
    logs.push({ at: new Date().toISOString(), level: success ? 'success' : 'error', message: success ? '测试完成，未对外发送通知或写入项目数据。' : `测试未通过：${failureMessage}` })
    const run: AutomationRun = {
      id: randomUUID(),
      status: success ? 'success' : 'failed',
      startedAt: nowLabelFor(startedAt),
      duration: durationLabel(Date.now() - startedAt.getTime()),
      summary: success ? `配置校验通过：${automation.action}` : `测试未通过：${failureMessage}`,
      detail: success ? '触发条件、执行动作和项目文件夹均已通过校验。本次测试不对外发送通知或写入项目数据。' : failureMessage,
      logs
    }
    const updated: Automation = { ...automation, runs: [run, ...automation.runs] }
    if (!success && automation.state === 'active') updated.state = 'attention'
    return this.replace(updated)
  }

  async recordExecution(id: string, input: {
    status: AutomationRun['status']
    startedAt: Date
    durationMs: number
    summary: string
    detail?: string
    output?: AutomationRunOutput
    logs?: AutomationRunLog[]
    needsAttention?: boolean
  }): Promise<Automation> {
    const automation = await this.get(id)
    const run: AutomationRun = {
      id: randomUUID(),
      status: input.status,
      startedAt: nowLabelFor(input.startedAt),
      duration: durationLabel(input.durationMs),
      summary: input.summary,
      ...(input.detail ? { detail: input.detail } : {}),
      ...(input.output ? { output: input.output } : {}),
      ...(input.logs?.length ? { logs: input.logs } : {})
    }
    const updated: Automation = { ...automation, runs: [run, ...automation.runs] }
    if (automation.schedule?.type === 'once') {
      updated.state = 'paused'
      delete updated.schedule
    } else if (automation.schedule?.type === 'daily') {
      updated.schedule = { ...automation.schedule, nextRunAt: nextDailyRun(automation.schedule.nextRunAt, input.startedAt).toISOString() }
    }
    if (input.needsAttention) updated.state = 'attention'
    return this.replace(updated)
  }

  async delete(id: string): Promise<void> {
    const items = await this.readAll()
    const next = items.filter((item) => item.id !== id)
    if (next.length === items.length) throw new Error(`未找到自动化「${id}」。请先调用 koala_list_automations 获取有效 ID。`)
    await this.writeAll(next)
  }

  private async replace(updated: Automation): Promise<Automation> {
    const items = await this.readAll()
    const index = items.findIndex((item) => item.id === updated.id)
    if (index === -1) throw new Error(`未找到自动化「${updated.id}」。`)
    items[index] = updated
    await this.writeAll(items)
    return updated
  }
}

function validateSchedule(schedule: NonNullable<CreateAutomationInput['schedule']>): NonNullable<CreateAutomationInput['schedule']> {
  const date = new Date(schedule.nextRunAt)
  if (Number.isNaN(date.getTime())) throw new Error('计划执行时间必须是有效的 ISO 时间。')
  return { type: schedule.type, nextRunAt: date.toISOString() }
}

function nowLabelFor(date: Date): string {
  return `今天 ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)}`
}

function durationLabel(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000))
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
}

function nextDailyRun(previous: string, after: Date): Date {
  const next = new Date(previous)
  do next.setUTCDate(next.getUTCDate() + 1)
  while (next <= after)
  return next
}
