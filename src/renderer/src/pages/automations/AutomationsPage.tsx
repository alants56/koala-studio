import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { ApiOutlined, CheckCircleFilled, ClockCircleOutlined, CloseCircleFilled, CopyOutlined, DeleteOutlined, ExclamationCircleFilled, FileSearchOutlined, FolderOpenOutlined, MoreOutlined, PlayCircleOutlined, PlusOutlined, RocketOutlined, SearchOutlined, SendOutlined, ThunderboltFilled } from '@ant-design/icons'
import { App, Badge, Button, Dropdown, Empty, Input, Modal, Select, Segmented, Space, Switch, Tag, Tooltip } from 'antd'
import type { Automation, AutomationRun, AutomationState, CreateAutomationInput } from '@shared/automations'
import { MarkdownMessage } from '../../components/chat/MarkdownMessage'
import { projectsApi } from '../../services/projects'

type DetailTab = 'workflow' | 'runs' | 'process' | 'settings'

interface DraftAutomation { name: string; trigger: string; action: string; scope: string; scheduledAt: string; projectPath: string; instruction: string }

const EMPTY_DRAFT: DraftAutomation = { name: '', trigger: '指定时间', action: '让 Claude Code 执行指令', scope: '指定项目', scheduledAt: '', projectPath: '', instruction: '' }
const STATE_META: Record<AutomationState, { label: string; color: 'success' | 'default' | 'error' }> = {
  active: { label: '运行中', color: 'success' }, paused: { label: '已暂停', color: 'default' }, attention: { label: '需处理', color: 'error' }
}
function lastRun(automation: Automation): AutomationRun | undefined { return automation.runs[0] }

/** 自动化管理：本地持久化的规则、测试运行和运行记录工作台。 */
export function AutomationsPage(): ReactElement {
  const { message, modal } = App.useApp()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [detailTab, setDetailTab] = useState<DetailTab>('workflow')
  const [createOpen, setCreateOpen] = useState(false)
  const [draft, setDraft] = useState<DraftAutomation>(EMPTY_DRAFT)
  const [resultRun, setResultRun] = useState<AutomationRun>()
  const [pickingProjectPath, setPickingProjectPath] = useState(false)

  const refreshAutomations = useCallback((reportError = false): void => {
    void window.automations.list({ limit: 100 }).then(({ items }) => {
      setAutomations(items)
      setSelectedId((current) => current || items[0]?.id || '')
    }).catch(() => { if (reportError) void message.error('无法读取自动化数据。') })
  }, [message])

  useEffect(() => {
    refreshAutomations(true)
    const timer = window.setInterval(() => refreshAutomations(), 15_000)
    return () => window.clearInterval(timer)
  }, [refreshAutomations])

  const replaceAutomation = (automation: Automation): void => setAutomations((items) => items.map((item) => item.id === automation.id ? automation : item))
  const filtered = useMemo(() => automations.filter((automation) => {
    const search = `${automation.name} ${automation.description} ${automation.trigger} ${automation.action}`.toLowerCase()
    return (filter === 'all' || automation.state === filter) && (!query.trim() || search.includes(query.trim().toLowerCase()))
  }), [automations, filter, query])
  const selected = automations.find((automation) => automation.id === selectedId) ?? filtered[0] ?? automations[0]
  const activeCount = automations.filter((automation) => automation.state === 'active').length
  const issueCount = automations.filter((automation) => automation.state === 'attention').length
  const todaySuccesses = automations.flatMap((automation) => automation.runs).filter((run) => run.status === 'success' && run.startedAt.startsWith('今天')).length

  const toggle = (id: string, enabled: boolean): void => {
    void window.automations.setEnabled(id, enabled).then((automation) => { replaceAutomation(automation); void message.success(enabled ? '自动化已启用' : '自动化已暂停') }).catch((error: unknown) => void message.error(errorText(error, '无法更新自动化状态。')))
  }
  const run = (automation: Automation): void => {
    void window.automations.runTest(automation.id).then((updated) => { replaceAutomation(updated); void message.success('测试运行已完成') }).catch(() => void message.error('测试运行失败。'))
  }
  const openRuns = (automation: Automation): void => {
    setSelectedId(automation.id)
    setDetailTab('runs')
  }
  const duplicate = (automation: Automation): void => {
    void window.automations.create({ name: `${automation.name} 副本`, description: automation.description, trigger: automation.trigger, triggerDetail: automation.triggerDetail, action: automation.action, actionDetail: automation.actionDetail, scope: automation.scope, actionType: automation.actionType, projectPath: automation.projectPath, instruction: automation.instruction, enabled: false }).then((copy) => { setAutomations((items) => [copy, ...items]); setSelectedId(copy.id); void message.success('已创建副本') }).catch(() => void message.error('无法创建自动化。'))
  }
  const remove = (automation: Automation): void => {
    modal.confirm({ title: '删除自动化', content: `确定删除「${automation.name}」吗？运行记录也会一并移除。`, okText: '删除', cancelText: '取消', okButtonProps: { danger: true }, onOk: async () => { await window.automations.delete(automation.id); setAutomations((items) => items.filter((item) => item.id !== automation.id)); if (selectedId === automation.id) setSelectedId(''); void message.success('自动化已删除') } })
  }
  const pickProjectPath = async (): Promise<void> => {
    setPickingProjectPath(true)
    try {
      const path = await projectsApi.pickDirectory()
      if (path) setDraft((current) => ({ ...current, projectPath: path }))
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '无法选择项目文件夹')
    } finally {
      setPickingProjectPath(false)
    }
  }
  const create = (): void => {
    if (!draft.name.trim()) { void message.error('请填写自动化名称'); return }
    const actionType = draft.action === '让 Claude Code 执行指令' ? 'claude_prompt' as const : draft.action === '让 Pi 执行指令' ? 'pi_prompt' as const : draft.action === '创建高优先级待办' ? 'create_high_priority_todo' as const : undefined
    const scheduledAction = draft.trigger === '指定时间' && actionType
    if (draft.trigger === '指定时间' && !actionType) { void message.error('请选择有效的执行动作'); return }
    if (actionType && !scheduledAction) { void message.error('该执行动作需要指定执行时间'); return }
    if (scheduledAction && !draft.scheduledAt) { void message.error('请选择执行时间'); return }
    if (actionType === 'claude_prompt' && !draft.projectPath.trim()) { void message.error('请选择项目文件夹'); return }
    if (actionType === 'claude_prompt' && !draft.instruction.trim()) { void message.error('请填写 Claude Code 自定义指令'); return }
    if (actionType === 'pi_prompt' && !draft.projectPath.trim()) { void message.error('请选择项目文件夹'); return }
    if (actionType === 'pi_prompt' && !draft.instruction.trim()) { void message.error('请填写 Pi 自定义指令'); return }
    const scheduledAt = scheduledAction ? new Date(draft.scheduledAt) : undefined
    if (scheduledAt && (Number.isNaN(scheduledAt.getTime()) || scheduledAt <= new Date())) { void message.error('执行时间需要晚于当前时间'); return }
    const input: CreateAutomationInput = {
      name: draft.name.trim(), trigger: draft.trigger, triggerDetail: scheduledAt ? `计划于 ${formatSchedule(scheduledAt)}` : undefined,
      action: draft.action, actionDetail: actionType === 'claude_prompt' ? 'Claude Code 独立会话' : actionType === 'pi_prompt' ? 'Pi 独立会话' : actionType === 'create_high_priority_todo' ? '工作台' : undefined, scope: draft.scope,
      ...(scheduledAt && actionType ? { schedule: { type: 'once' as const, nextRunAt: scheduledAt.toISOString() }, actionType, ...((actionType === 'claude_prompt' || actionType === 'pi_prompt') ? { projectPath: draft.projectPath.trim(), instruction: draft.instruction.trim() } : {}) } : {})
    }
    void window.automations.create(input).then((automation) => { setAutomations((items) => [automation, ...items]); setSelectedId(automation.id); setCreateOpen(false); setDraft(EMPTY_DRAFT); void message.success('自动化已创建并启用') }).catch((error: unknown) => void message.error(errorText(error, '无法创建自动化。')))
  }
  const actionMenu = (automation: Automation) => ({ items: [
    { key: 'run', icon: <PlayCircleOutlined />, label: '测试运行', onClick: () => run(automation) },
    { key: 'copy', icon: <CopyOutlined />, label: '创建副本', onClick: () => duplicate(automation) },
    { type: 'divider' as const },
    { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true, onClick: () => remove(automation) }
  ] })

  return <div className="automations-page">
    <header className="automation-header"><div><div className="automation-kicker"><ThunderboltFilled /> 自动化中心</div><h1>让重复工作自己发生</h1><p>管理触发条件、执行动作和每一次运行结果。</p></div><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>新建自动化</Button></header>
    <section className="automation-health" aria-label="自动化运行概览">
      <HealthItem icon={<ThunderboltFilled />} className="is-active" value={activeCount} label="正在运行" />
      <HealthItem icon={<CheckCircleFilled />} className="is-success" value={todaySuccesses} label="今日成功运行" />
      <HealthItem icon={<ExclamationCircleFilled />} className={issueCount ? 'is-alert' : 'is-neutral'} value={issueCount} label="需要处理" />
      <div className="automation-health-note"><span className="automation-pulse" /> 所有运行记录保存在此设备</div>
    </section>
    <div className="automation-workspace">
      <section className="automation-list-panel" aria-label="自动化列表">
        <div className="automation-list-toolbar"><Segmented value={filter} onChange={(value) => setFilter(String(value))} options={[{ label: `全部 ${automations.length}`, value: 'all' }, { label: `运行中 ${activeCount}`, value: 'active' }, { label: `需处理 ${issueCount}`, value: 'attention' }, { label: '已暂停', value: 'paused' }]} /><Input prefix={<SearchOutlined />} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索自动化" allowClear /></div>
        <div className="automation-list-heading" aria-hidden="true"><span>自动化</span><span>触发条件</span><span>最近运行</span><span>状态</span><span /></div>
        <div className="automation-list">{filtered.length ? filtered.map((automation) => {
          const recent = lastRun(automation); const meta = STATE_META[automation.state]
          return <article key={automation.id} className={`automation-row ${selected?.id === automation.id ? 'is-selected' : ''}`} onClick={() => { setSelectedId(automation.id); setDetailTab(recent ? 'runs' : 'workflow') }}>
            <div className="automation-row-name"><span className={`automation-row-icon ${automation.state === 'attention' ? 'is-problem' : ''}`}>{automation.triggerDetail === '事件触发' ? <ApiOutlined /> : <ClockCircleOutlined />}</span><div><strong>{automation.name}</strong><span>{automation.action}</span></div></div>
            <div className="automation-trigger"><span>{automation.trigger}</span><small>{automation.triggerDetail}</small></div>
            <div className={`automation-last-run ${recent?.status ?? ''}`}>{recent ? <><span>{recent.startedAt}</span><small>{recent.status === 'failed' ? '上次运行失败' : recent.summary}</small></> : <><span>尚未运行</span><small>启用后等待触发</small></>}</div>
            <div><Badge status={meta.color} text={meta.label} /></div>
            <div className="automation-row-actions" onClick={(event) => event.stopPropagation()}><Tooltip title="查看运行结果"><Button type="text" size="small" aria-label="查看运行结果" icon={<FileSearchOutlined />} onClick={() => openRuns(automation)} /></Tooltip><Tooltip title={automation.state === 'active' ? '暂停' : '启用'}><Switch size="small" checked={automation.state === 'active'} onChange={(enabled) => toggle(automation.id, enabled)} /></Tooltip><Dropdown menu={actionMenu(automation)} trigger={['click']}><Button type="text" size="small" aria-label="更多操作" icon={<MoreOutlined />} /></Dropdown></div>
          </article>
        }) : <Empty className="automation-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的自动化" />}</div>
      </section>
      {selected && <aside className="automation-detail" aria-label={`${selected.name}详情`}>
        <div className="automation-detail-top"><div className="automation-detail-title"><span className="automation-detail-icon"><ThunderboltFilled /></span><div><h2>{selected.name}</h2><p>{selected.description}</p></div></div><Dropdown menu={actionMenu(selected)} trigger={['click']}><Button type="text" icon={<MoreOutlined />} aria-label="更多操作" /></Dropdown></div>
        <div className="automation-detail-controls"><Tag color={STATE_META[selected.state].color}>{STATE_META[selected.state].label}</Tag><Switch checked={selected.state === 'active'} checkedChildren="运行中" unCheckedChildren="已暂停" onChange={(enabled) => toggle(selected.id, enabled)} /><Button icon={<PlayCircleOutlined />} onClick={() => run(selected)}>测试</Button></div>
        <Segmented className="automation-detail-tabs" value={detailTab} onChange={(value) => setDetailTab(value as DetailTab)} options={[{ label: '流程', value: 'workflow' }, { label: `运行 ${selected.runs.length}`, value: 'runs' }, { label: '执行过程', value: 'process' }, { label: '设置', value: 'settings' }]} />
        {detailTab === 'workflow' && <WorkflowView automation={selected} />}{detailTab === 'runs' && <RunsView runs={selected.runs} onViewResult={setResultRun} />}{detailTab === 'process' && <ProcessView runs={selected.runs} />}{detailTab === 'settings' && <SettingsView automation={selected} onDelete={() => remove(selected)} />}
      </aside>}
    </div>
    <Modal title="新建自动化" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={create} okText="创建并启用" cancelText="取消" destroyOnHidden><div className="automation-form"><label>名称<Input autoFocus placeholder="例如：让 Claude 整理今日进展" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label><SelectField label="触发条件" value={draft.trigger} values={['指定时间', '每天 09:00', '每周一 09:00', '创建项目时', '运行失败时', '项目 7 天无活动时']} onChange={(trigger) => setDraft((current) => ({ ...current, trigger }))} />{draft.trigger === '指定时间' && <label>执行时间<Input type="datetime-local" value={draft.scheduledAt} onChange={(event) => setDraft((current) => ({ ...current, scheduledAt: event.target.value }))} /></label>}<SelectField label="执行动作" value={draft.action} values={['让 Claude Code 执行指令', '让 Pi 执行指令', '创建高优先级待办']} onChange={(action) => setDraft((current) => ({ ...current, action }))} />{(draft.action === '让 Claude Code 执行指令' || draft.action === '让 Pi 执行指令') && <label>自定义指令<Input.TextArea autoSize={{ minRows: 4, maxRows: 9 }} maxLength={4000} showCount placeholder="例如：检查当前项目的测试失败，修复能安全确认的问题，并总结修改和验证结果。" value={draft.instruction} onChange={(event) => setDraft((current) => ({ ...current, instruction: event.target.value }))} /></label>}{(draft.action === '让 Claude Code 执行指令' || draft.action === '让 Pi 执行指令') && <label>项目文件夹<Space.Compact className="automation-path-picker"><Input placeholder="选择项目文件夹" readOnly value={draft.projectPath} onClick={() => void pickProjectPath()} /><Button icon={<FolderOpenOutlined />} loading={pickingProjectPath} onClick={() => void pickProjectPath()}>选择文件夹</Button></Space.Compact></label>}<SelectField label="作用范围" value={draft.scope} values={['指定项目', '全部活跃项目', '全部项目', '全部自动化', '新建项目']} onChange={(scope) => setDraft((current) => ({ ...current, scope }))} /></div></Modal>
    <ResultModal run={resultRun} onClose={() => setResultRun(undefined)} onCopy={(content) => { void navigator.clipboard.writeText(content).then(() => message.success('运行结果已复制')).catch(() => message.error('无法复制运行结果')) }} />
  </div>
}

function HealthItem({ icon, className, value, label }: { icon: ReactElement; className: string; value: number; label: string }): ReactElement { return <div className="automation-health-item"><span className={`automation-health-icon ${className}`}>{icon}</span><div><strong>{value}</strong><span>{label}</span></div></div> }
function SelectField({ label, value, values, onChange }: { label: string; value: string; values: string[]; onChange: (value: string) => void }): ReactElement { return <label>{label}<Select value={value} onChange={onChange} options={values.map((item) => ({ value: item, label: item }))} /></label> }
function formatSchedule(date: Date): string { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date) }
function errorText(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
function WorkflowView({ automation }: { automation: Automation }): ReactElement { return <div className="automation-workflow"><WorkflowNode className="trigger" icon={<ClockCircleOutlined />} label="当这件事发生" title={automation.trigger} description={`${automation.triggerDetail} · ${automation.scope}`} /><Connector /><WorkflowNode className="condition" icon={<FileSearchOutlined />} label="检查条件" title="符合自动化范围" description={`只处理：${automation.scope}`} /><Connector /><WorkflowNode className="action" icon={<SendOutlined />} label="执行动作" title={automation.action} description={`目标：${automation.actionDetail}`} /><div className="workflow-foot"><RocketOutlined /> 测试运行不会对外发送通知或写入项目数据。</div></div> }
function WorkflowNode({ className, icon, label, title, description }: { className: string; icon: ReactElement; label: string; title: string; description: string }): ReactElement { return <div className={`workflow-node ${className}`}><span className="workflow-icon">{icon}</span><div><small>{label}</small><strong>{title}</strong><p>{description}</p></div></div> }
function Connector(): ReactElement { return <div className="workflow-connector"><span /></div> }
function RunsView({ runs, onViewResult }: { runs: AutomationRun[]; onViewResult: (run: AutomationRun) => void }): ReactElement { return runs.length ? <div className="automation-runs">{runs.map((run) => <div className="automation-run" key={run.id}><span className={`automation-run-icon ${run.status}`}>{run.status === 'failed' ? <CloseCircleFilled /> : <CheckCircleFilled />}</span><div className="automation-run-body"><div className="automation-run-heading"><strong>{run.summary}</strong>{(run.output || run.detail) && <Button type="link" size="small" icon={<FileSearchOutlined />} onClick={() => onViewResult(run)}>查看结果</Button>}</div><p>{run.detail || (run.status === 'success' ? '本次运行已完成。' : '本次运行未产生结果。')}</p><small>{run.startedAt} · 用时 {run.duration}</small></div></div>)}</div> : <Empty className="automation-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无运行记录" /> }
function ProcessView({ runs }: { runs: AutomationRun[] }): ReactElement {
  return runs.length ? <div className="automation-process">{runs.map((run) => <section className="automation-process-run" key={run.id}><header><span className={`automation-run-icon ${run.status}`}>{run.status === 'failed' ? <CloseCircleFilled /> : <CheckCircleFilled />}</span><div><strong>{run.summary}</strong><small>{run.startedAt} · 用时 {run.duration}</small></div></header>{run.logs?.length ? <div className="automation-log-list">{run.logs.map((log, index) => <div className={`automation-log-entry is-${log.level}`} key={`${log.at}-${index}`}><time dateTime={log.at} title={formatLogDate(log.at)}>{formatLogTime(log.at)}</time><span className="automation-log-dot" /><p>{log.message}</p></div>)}</div> : <div className="automation-log-empty">该次运行产生于过程日志启用前，没有可复盘的步骤。</div>}</section>)}</div> : <Empty className="automation-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无执行过程" />
}
function formatLogTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '--:--:--' : new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date)
}
function formatLogDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(date)
}
function ResultModal({ run, onClose, onCopy }: { run?: AutomationRun; onClose: () => void; onCopy: (content: string) => void }): ReactElement {
  const result = run?.output ?? (run?.detail ? { title: run.status === 'failed' ? '失败详情' : '运行结果', content: run.detail, format: 'text' as const } : undefined)
  return <Modal className="automation-result-modal" title={result?.title ?? '运行结果'} open={Boolean(run)} width={760} onCancel={onClose} destroyOnHidden footer={<><Button onClick={onClose}>关闭</Button>{result && <Button type="primary" icon={<CopyOutlined />} onClick={() => onCopy(result.content)}>复制结果</Button>}</>}>
    {run && <><div className="automation-result-meta"><Badge status={run.status === 'success' ? 'success' : 'error'} text={run.status === 'success' ? '运行成功' : '运行失败'} /><span>{run.startedAt}</span><span>用时 {run.duration}</span></div>{result ? <div className={`automation-result-content is-${result.format}`}>{result.format === 'markdown' ? <MarkdownMessage content={result.content} /> : <pre>{result.content}</pre>}</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="本次运行没有可展示的结果" />}</>}
  </Modal>
}
function SettingsView({ automation, onDelete }: { automation: Automation; onDelete: () => void }): ReactElement {
  const usesClaude = automation.actionType === 'claude_prompt'
  return <div className="automation-settings">
    <div><div><strong>执行范围</strong><span>{automation.projectPath || automation.scope}</span></div><Tag>{automation.scope}</Tag></div>
    {usesClaude && <div className="automation-instruction-setting"><div><strong>自定义指令</strong><span>{automation.instruction}</span></div></div>}
    <div><div><strong>失败通知</strong><span>运行失败时，在工作台创建高优先级待办。</span></div><Switch defaultChecked /></div>
    <div><div><strong>工具权限</strong><span>{usesClaude ? 'Claude Code 可在所选项目中执行单次工具操作。' : '此自动化只读取项目状态。'}</span></div><Tag color={usesClaude ? 'warning' : 'success'}>{usesClaude ? '单次授权' : '只读'}</Tag></div>
    <div className="automation-danger"><div><strong>删除自动化</strong><span>删除后无法恢复规则及其运行记录。</span></div><Button danger icon={<DeleteOutlined />} onClick={onDelete}>删除</Button></div>
  </div>
}
