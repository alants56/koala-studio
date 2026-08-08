import { homedir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { AutomationStore } from '../shared/automation-store'
import { TodoStore } from '../shared/todo-store'

const file = process.env.KOALA_AUTOMATIONS_FILE || join(homedir(), 'Library', 'Application Support', 'koala-studio', 'automations.json')
const store = new AutomationStore(file)
const todosFile = process.env.KOALA_TODOS_FILE || join(homedir(), 'Library', 'Application Support', 'koala-studio', 'todos.json')
const todoStore = new TodoStore(todosFile)
const server = new McpServer({ name: 'koala-automations-mcp-server', version: '0.1.0' })
const scheduleSchema = z.object({
  type: z.enum(['once', 'daily']),
  nextRunAt: z.string().datetime({ offset: true }).describe('下一次执行时间，ISO 8601 UTC，例如 2026-08-08T06:30:00.000Z。')
})

function result(payload: unknown): { content: [{ type: 'text'; text: string }]; structuredContent: Record<string, unknown> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent: payload as Record<string, unknown> }
}

async function execute<T>(operation: () => Promise<T>): Promise<ReturnType<typeof result>> {
  try { return result(await operation()) } catch (error) { return { content: [{ type: 'text', text: error instanceof Error ? error.message : '自动化操作失败。' }], structuredContent: { error: true } } }
}

server.registerTool('koala_list_automations', {
  title: '列出 Koala 自动化', description: '列出 Koala Studio 的自动化规则。可按状态、关键词筛选并分页。',
  inputSchema: { state: z.enum(['active', 'paused', 'attention']).optional(), query: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, async (input) => execute(() => store.list(input)))

server.registerTool('koala_get_automation', {
  title: '读取 Koala 自动化', description: '按 ID 获取一条自动化规则及其运行记录。', inputSchema: { id: z.string().min(1) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, async ({ id }) => execute(() => store.get(id)))

server.registerTool('koala_create_automation', {
  title: '创建 Koala 自动化', description: '创建一条自动化规则。重要：创建 trigger=指定时间 的启用任务时，必须同时传 schedule、actionType=feature_brief 和绝对 projectPath；仅在 triggerDetail 中写“计划于某时”不会触发执行。默认启用；创建后可用 koala_test_automation 验证流程。',
  inputSchema: { name: z.string().min(1).max(120), description: z.string().max(500).optional(), trigger: z.string().min(1).max(120), triggerDetail: z.string().max(120).optional(), action: z.string().min(1).max(120), actionDetail: z.string().max(120).optional(), scope: z.string().min(1).max(120), enabled: z.boolean().optional(), schedule: scheduleSchema.optional(), actionType: z.enum(['feature_brief']).optional(), projectPath: z.string().min(1).max(4096).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
}, async (input) => execute(() => store.create(input)))

server.registerTool('koala_update_automation', {
  title: '更新 Koala 自动化', description: '更新一条自动化的名称、触发条件、动作、作用范围或计划。schedule 传 null 可取消计划。',
  inputSchema: { id: z.string().min(1), name: z.string().min(1).max(120).optional(), description: z.string().max(500).optional(), trigger: z.string().min(1).max(120).optional(), triggerDetail: z.string().max(120).optional(), action: z.string().min(1).max(120).optional(), actionDetail: z.string().max(120).optional(), scope: z.string().min(1).max(120).optional(), schedule: scheduleSchema.nullable().optional(), actionType: z.enum(['feature_brief']).optional(), projectPath: z.string().min(1).max(4096).nullable().optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, async ({ id, ...input }) => execute(() => store.update(id, input)))

server.registerTool('koala_set_automation_enabled', {
  title: '启用或暂停 Koala 自动化', description: '切换指定自动化的启用状态。', inputSchema: { id: z.string().min(1), enabled: z.boolean() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, async ({ id, enabled }) => execute(() => store.setEnabled(id, enabled)))

server.registerTool('koala_test_automation', {
  title: '测试运行 Koala 自动化', description: '手动测试一条自动化，并记录一次不对外发送通知或写入项目数据的成功运行。', inputSchema: { id: z.string().min(1) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
}, async ({ id }) => execute(() => store.runTest(id)))

server.registerTool('koala_delete_automation', {
  title: '删除 Koala 自动化', description: '删除一条自动化及其运行记录。请先确认 ID。', inputSchema: { id: z.string().min(1) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
}, async ({ id }) => execute(async () => { await store.delete(id); return { id, deleted: true } }))

server.registerTool('koala_list_todos', {
  title: '列出 Koala 待办', description: '列出 Koala Studio 待办。可按完成状态、重点、项目或关键词筛选并分页。',
  inputSchema: { status: z.enum(['active', 'done', 'all']).optional(), important: z.boolean().optional(), projectId: z.string().min(1).optional(), query: z.string().max(200).optional(), limit: z.number().int().min(1).max(100).optional(), offset: z.number().int().min(0).optional() },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, async (input) => execute(() => todoStore.list(input)))

server.registerTool('koala_get_todo', {
  title: '读取 Koala 待办', description: '按 ID 获取一条待办及其项目、会话关联信息。', inputSchema: { id: z.string().min(1) },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, async ({ id }) => execute(() => todoStore.get(id)))

server.registerTool('koala_create_todo', {
  title: '创建 Koala 待办', description: '创建一条待办，可选标记重点或关联已有项目和会话。',
  inputSchema: { title: z.string().min(1).max(100), important: z.boolean().optional(), projectId: z.string().min(1).optional(), sessionId: z.string().min(1).optional(), sessionTitle: z.string().max(200).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
}, async (input) => execute(() => todoStore.create(input)))

server.registerTool('koala_update_todo', {
  title: '更新 Koala 待办', description: '更新待办内容、完成状态、重点标记或关联信息。至少提供一个待更新字段。',
  inputSchema: { id: z.string().min(1), title: z.string().min(1).max(100).optional(), done: z.boolean().optional(), important: z.boolean().optional(), projectId: z.string().optional(), sessionId: z.string().optional(), sessionTitle: z.string().max(200).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, async ({ id, ...input }) => execute(() => todoStore.update(id, input)))

server.registerTool('koala_set_todo_done', {
  title: '完成或恢复 Koala 待办', description: '把指定待办标为已完成或未完成。', inputSchema: { id: z.string().min(1), done: z.boolean() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, async ({ id, done }) => execute(() => todoStore.setDone(id, done)))

server.registerTool('koala_delete_todo', {
  title: '删除 Koala 待办', description: '删除指定待办。请先确认 ID。', inputSchema: { id: z.string().min(1) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
}, async ({ id }) => execute(async () => { await todoStore.delete(id); return { id, deleted: true } }))

void server.connect(new StdioServerTransport()).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : '无法启动 Koala 自动化 MCP 服务。'}\n`)
  process.exitCode = 1
})
