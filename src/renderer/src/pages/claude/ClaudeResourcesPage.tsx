import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  App,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Segmented,
  Skeleton,
  Space,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {
  ApiOutlined,
  CheckCircleFilled,
  CodeOutlined,
  DeleteOutlined,
  EditOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  StopOutlined,
  SyncOutlined
} from '@ant-design/icons'
import type { ClaudeMcp, ClaudePlugin, ClaudeResources, ClaudeSkill, SaveClaudeMcpInput } from '@shared/claude'

type ResourceTab = 'skills' | 'plugins' | 'mcps'

const DEFAULT_SKILL = `---
name: new-skill
description: Describe when Claude should use this skill.
---

# New skill

Write the instructions Claude should follow here.
`

const DEFAULT_MCP = `{
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "your-mcp-server"]
}`

function formatDate(value: string): string {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

function redactMcpConfig(config: Record<string, unknown>): string {
  const copy = JSON.parse(JSON.stringify(config)) as Record<string, unknown>
  for (const key of ['env', 'headers']) {
    if (copy[key] && typeof copy[key] === 'object') copy[key] = '[已隐藏敏感配置]'
  }
  return JSON.stringify(copy)
}

/** 管理 ~/.claude 中由当前用户维护的 Skills、插件与 MCP。 */
export function ClaudeResourcesPage(): ReactElement {
  const { message, modal } = App.useApp()
  const [tab, setTab] = useState<ResourceTab>('skills')
  const [resources, setResources] = useState<ClaudeResources>()
  const [loading, setLoading] = useState(true)
  const [busyPlugin, setBusyPlugin] = useState<string>()
  const [skillEditor, setSkillEditor] = useState<{ id?: string; name: string; content: string }>()
  const [mcpEditor, setMcpEditor] = useState<ClaudeMcp>()
  const [creatingMcp, setCreatingMcp] = useState(false)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      setResources(await window.claude.list())
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '无法读取 Claude 本地资源。')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { void refresh() }, [refresh])

  const counts = useMemo(() => ({
    skills: resources?.skills.length ?? 0,
    plugins: resources?.plugins.length ?? 0,
    mcps: resources?.mcps.length ?? 0
  }), [resources])

  const editSkill = async (skill: ClaudeSkill): Promise<void> => {
    try {
      setSkillEditor({ id: skill.id, name: skill.name, content: await window.claude.readSkill(skill.id) })
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '无法读取 Skill。')
    }
  }

  const removeSkill = (skill: ClaudeSkill): void => {
    modal.confirm({
      title: `删除 Skill「${skill.name}」？`,
      content: '将移除 ~/.claude/skills 中对应的整个目录，无法恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.claude.removeSkill(skill.id)
        void message.success('Skill 已删除')
        await refresh()
      }
    })
  }

  const runPluginAction = async (plugin: ClaudePlugin, action: 'enable' | 'disable' | 'update' | 'uninstall'): Promise<void> => {
    setBusyPlugin(`${plugin.id}:${action}`)
    try {
      await window.claude.pluginAction(action, plugin.id)
      void message.success(action === 'uninstall' ? '插件已卸载' : action === 'update' ? '插件已更新' : action === 'enable' ? '插件已启用' : '插件已停用')
      await refresh()
    } catch (error) {
      void message.error(error instanceof Error ? error.message : '插件操作失败。')
    } finally {
      setBusyPlugin(undefined)
    }
  }

  const removeMcp = (mcp: ClaudeMcp): void => {
    modal.confirm({
      title: `移除 MCP「${mcp.name}」？`,
      content: '这会从 Claude 的本地配置中删除该服务。',
      okText: '移除',
      okButtonProps: { danger: true },
      onOk: async () => {
        await window.claude.removeMcp(mcp.name, mcp.scope, mcp.projectPath)
        void message.success('MCP 已移除')
        await refresh()
      }
    })
  }

  return (
    <div className="claude-resources-page">
      <div className="resource-heading">
        <div>
          <div className="resource-eyebrow"><CodeOutlined /> CLAUDE 本地资源</div>
          <Typography.Title level={2} className="page-title">插件</Typography.Title>
          <Typography.Text className="page-subtitle">在一个地方维护本机 Claude Code 的 Skills、插件和 MCP 服务。</Typography.Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void refresh()} loading={loading}>刷新</Button>
      </div>

      <div className="resource-overview" aria-label="本地资源概览">
        <button className={tab === 'skills' ? 'resource-counter active' : 'resource-counter'} onClick={() => setTab('skills')}>
          <span className="resource-counter-icon skill"><CodeOutlined /></span><span><b>{counts.skills}</b> Skills</span>
        </button>
        <button className={tab === 'plugins' ? 'resource-counter active' : 'resource-counter'} onClick={() => setTab('plugins')}>
          <span className="resource-counter-icon plugin"><RocketOutlined /></span><span><b>{counts.plugins}</b> 插件</span>
        </button>
        <button className={tab === 'mcps' ? 'resource-counter active' : 'resource-counter'} onClick={() => setTab('mcps')}>
          <span className="resource-counter-icon mcp"><ApiOutlined /></span><span><b>{counts.mcps}</b> MCP 服务</span>
        </button>
      </div>

      <div className="resource-toolbar">
        <Segmented<ResourceTab>
          value={tab}
          onChange={setTab}
          options={[
            { label: 'Skills', value: 'skills', icon: <CodeOutlined /> },
            { label: '插件', value: 'plugins', icon: <RocketOutlined /> },
            { label: 'MCP', value: 'mcps', icon: <ApiOutlined /> }
          ]}
        />
        {tab === 'skills' && <Button type="primary" icon={<PlusOutlined />} onClick={() => setSkillEditor({ name: '', content: DEFAULT_SKILL })}>新建 Skill</Button>}
        {tab === 'mcps' && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreatingMcp(true)}>添加 MCP</Button>}
      </div>

      {loading ? <ResourceSkeleton /> : tab === 'skills' ? <SkillsList skills={resources?.skills ?? []} onEdit={editSkill} onDelete={removeSkill} /> : null}
      {!loading && tab === 'plugins' ? <PluginsList plugins={resources?.plugins ?? []} busy={busyPlugin} onAction={runPluginAction} /> : null}
      {!loading && tab === 'mcps' ? <McpsList mcps={resources?.mcps ?? []} onEdit={setMcpEditor} onDelete={removeMcp} /> : null}

      <SkillEditor
        value={skillEditor}
        onCancel={() => setSkillEditor(undefined)}
        onSaved={async (input) => {
          await window.claude.saveSkill(input)
          setSkillEditor(undefined)
          void message.success('Skill 已保存')
          await refresh()
        }}
      />
      <McpEditor
        value={mcpEditor}
        open={creatingMcp || mcpEditor !== undefined}
        onCancel={() => { setCreatingMcp(false); setMcpEditor(undefined) }}
        onSaved={async (input) => {
          await window.claude.saveMcp(input)
          setCreatingMcp(false)
          setMcpEditor(undefined)
          void message.success('MCP 已保存')
          await refresh()
        }}
      />
    </div>
  )
}

function ResourceSkeleton(): ReactElement {
  return <div className="resource-list"><Skeleton active paragraph={{ rows: 3 }} /><Skeleton active paragraph={{ rows: 3 }} /></div>
}

function SkillsList({ skills, onEdit, onDelete }: { skills: ClaudeSkill[]; onEdit: (skill: ClaudeSkill) => void; onDelete: (skill: ClaudeSkill) => void }): ReactElement {
  if (!skills.length) return <Empty className="resource-empty" description="还没有本地 Skill" />
  return <div className="resource-list">{skills.map((skill) => (
    <Card className="resource-row" key={skill.id}>
      <span className="resource-symbol skill"><CodeOutlined /></span>
      <div className="resource-main"><div className="resource-title">{skill.name}</div><div className="resource-description">{skill.description}</div><div className="resource-meta">~/.claude/skills/{skill.id} · 更新于 {formatDate(skill.updatedAt)}</div></div>
      <Space className="resource-actions"><Tooltip title="编辑 Skill"><Button type="text" icon={<EditOutlined />} onClick={() => void onEdit(skill)} /></Tooltip><Tooltip title="删除 Skill"><Button type="text" danger icon={<DeleteOutlined />} onClick={() => onDelete(skill)} /></Tooltip></Space>
    </Card>
  ))}</div>
}

function PluginsList({ plugins, busy, onAction }: { plugins: ClaudePlugin[]; busy?: string; onAction: (plugin: ClaudePlugin, action: 'enable' | 'disable' | 'update' | 'uninstall') => void }): ReactElement {
  if (!plugins.length) return <Empty className="resource-empty" description="没有检测到已安装的 Claude 插件" />
  return <div className="resource-list">{plugins.map((plugin, index) => {
    const isBusy = (action: string): boolean => busy === `${plugin.id}:${action}`
    return <Card className="resource-row" key={`${plugin.id}:${plugin.scope}:${plugin.installPath}:${index}`}>
      <span className="resource-symbol plugin"><RocketOutlined /></span>
      <div className="resource-main"><div className="resource-title">{plugin.name} <Tag className="resource-tag">{plugin.marketplace}</Tag></div><div className="resource-description">{plugin.version} · {plugin.scope === 'user' ? '用户级' : plugin.scope === 'project' ? '项目级' : '本地级'}{plugin.projectPath ? ` · ${plugin.projectPath}` : ''}</div><div className="resource-meta">安装于 {formatDate(plugin.installedAt)} · {plugin.enabled ? '已启用' : '已停用'}</div></div>
      <Space className="resource-actions" size={2}>
        <Tooltip title={plugin.enabled ? '停用插件' : '启用插件'}><Button type="text" icon={isBusy(plugin.enabled ? 'disable' : 'enable') ? <LoadingOutlined /> : plugin.enabled ? <StopOutlined /> : <CheckCircleFilled />} onClick={() => onAction(plugin, plugin.enabled ? 'disable' : 'enable')} /></Tooltip>
        <Tooltip title="更新插件"><Button type="text" icon={isBusy('update') ? <LoadingOutlined /> : <SyncOutlined />} onClick={() => onAction(plugin, 'update')} /></Tooltip>
        <Tooltip title="卸载插件"><Button type="text" danger icon={isBusy('uninstall') ? <LoadingOutlined /> : <DeleteOutlined />} onClick={() => onAction(plugin, 'uninstall')} /></Tooltip>
      </Space>
    </Card>
  })}</div>
}

function McpsList({ mcps, onEdit, onDelete }: { mcps: ClaudeMcp[]; onEdit: (mcp: ClaudeMcp) => void; onDelete: (mcp: ClaudeMcp) => void }): ReactElement {
  if (!mcps.length) return <Empty className="resource-empty" description="还没有配置 MCP 服务" />
  return <div className="resource-list">{mcps.map((mcp) => (
    <Card className="resource-row" key={mcp.id}>
      <span className="resource-symbol mcp"><ApiOutlined /></span>
      <div className="resource-main"><div className="resource-title">{mcp.name} <Tag className="resource-tag">{mcp.scope === 'user' ? '用户级' : '项目级'}</Tag></div><div className="resource-description resource-code">{redactMcpConfig(mcp.config)}</div><div className="resource-meta">{mcp.projectPath ? mcp.projectPath : '~/.claude.json'}</div></div>
      <Space className="resource-actions"><Tooltip title="编辑 MCP"><Button type="text" icon={<EditOutlined />} onClick={() => onEdit(mcp)} /></Tooltip><Tooltip title="移除 MCP"><Button type="text" danger icon={<DeleteOutlined />} onClick={() => onDelete(mcp)} /></Tooltip></Space>
    </Card>
  ))}</div>
}

function SkillEditor({ value, onCancel, onSaved }: { value?: { id?: string; name: string; content: string }; onCancel: () => void; onSaved: (input: { id?: string; name: string; content: string }) => Promise<void> }): ReactElement {
  const [form] = Form.useForm<{ name: string; content: string }>()
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (value) form.setFieldsValue({ name: value.name, content: value.content }) }, [form, value])
  return <Modal open={value !== undefined} title={value?.id ? '编辑 Skill' : '新建 Skill'} onCancel={onCancel} destroyOnHidden width={780} okText="保存" confirmLoading={saving} onOk={() => { void form.validateFields().then(async (values) => { setSaving(true); try { await onSaved({ id: value?.id, ...values }) } finally { setSaving(false) } }) }}>
    <Form form={form} layout="vertical"><Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}><Input disabled={Boolean(value?.id)} placeholder="例如：release-helper" /></Form.Item><Form.Item label="SKILL.md" name="content" rules={[{ required: true, message: '请输入 Skill 内容' }]}><Input.TextArea className="resource-editor" autoSize={{ minRows: 16, maxRows: 24 }} spellCheck={false} /></Form.Item></Form>
  </Modal>
}

function McpEditor({ value, open, onCancel, onSaved }: { value?: ClaudeMcp; open: boolean; onCancel: () => void; onSaved: (input: SaveClaudeMcpInput) => Promise<void> }): ReactElement {
  const [form] = Form.useForm<{ name: string; scope: 'user' | 'project'; projectPath?: string; configText: string }>()
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (open) form.setFieldsValue({ name: value?.name ?? '', scope: value?.scope ?? 'user', projectPath: value?.projectPath, configText: JSON.stringify(value?.config ?? JSON.parse(DEFAULT_MCP), null, 2) }) }, [form, open, value])
  return <Modal open={open} title={value ? '编辑 MCP' : '添加 MCP'} onCancel={onCancel} destroyOnHidden width={720} okText="保存" confirmLoading={saving} onOk={() => { void form.validateFields().then(async (values) => { let config: unknown; try { config = JSON.parse(values.configText) } catch { form.setFields([{ name: 'configText', errors: ['请输入有效的 JSON 配置'] }]); return } if (!config || typeof config !== 'object' || Array.isArray(config)) { form.setFields([{ name: 'configText', errors: ['配置必须是 JSON 对象'] }]); return } setSaving(true); try { await onSaved({ originalName: value?.name, name: values.name, scope: values.scope, projectPath: values.scope === 'project' ? values.projectPath : undefined, config: config as Record<string, unknown> }) } finally { setSaving(false) } }) }}>
    <Form form={form} layout="vertical"><Form.Item label="服务名称" name="name" rules={[{ required: true, message: '请输入服务名称' }]}><Input placeholder="例如：filesystem" /></Form.Item><Form.Item label="作用域" name="scope"><Segmented options={[{ label: '用户级', value: 'user' }, { label: '项目级', value: 'project' }]} /></Form.Item><Form.Item noStyle shouldUpdate={(previous, current) => previous.scope !== current.scope}>{({ getFieldValue }) => getFieldValue('scope') === 'project' ? <Form.Item label="项目目录" name="projectPath" rules={[{ required: true, message: '请输入项目目录' }]}><Input placeholder="/Users/name/work/project" /></Form.Item> : null}</Form.Item><Form.Item label="服务配置（JSON）" name="configText" rules={[{ required: true, message: '请输入 MCP 配置' }]}><Input.TextArea className="resource-editor" autoSize={{ minRows: 10, maxRows: 18 }} spellCheck={false} /></Form.Item></Form>
  </Modal>
}
