import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
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
const todoColumnIdSchema = z.string().trim().min(1).max(80).describe('待办类型 ID，例如 backlog、in-progress 或 completed。')
const todoPositionSchema = z.number().int().min(0).describe('待办在类型内的位置，从 0 开始。')

function result(payload: unknown): { content: [{ type: 'text'; text: string }]; structuredContent: Record<string, unknown> } {
  const structuredContent = payload !== null && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : { result: payload }
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], structuredContent }
}

function failure(error: unknown): { content: [{ type: 'text'; text: string }]; structuredContent: { error: true; message: string }; isError: true } {
  const message = error instanceof Error ? error.message : 'Koala MCP 操作失败。'
  return { content: [{ type: 'text', text: message }], structuredContent: { error: true, message }, isError: true }
}

async function execute<T>(operation: () => Promise<T>): Promise<ReturnType<typeof result> | ReturnType<typeof failure>> {
  try { return result(await operation()) } catch (error) { return failure(error) }
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
  title: '创建 Koala 自动化', description: '创建一条自动化规则。重要：创建 trigger=指定时间 的启用任务时，必须同时传 schedule 和 actionType。actionType=claude_prompt 会启动独立 Claude Code 会话执行 instruction；actionType=pi_prompt 会启动独立 Pi 会话执行 instruction；两者都必须提供绝对 projectPath。actionType=create_high_priority_todo 会在工作台创建重点待办。仅在 triggerDetail 中写“计划于某时”不会触发执行。',
  inputSchema: { name: z.string().min(1).max(120), description: z.string().max(500).optional(), trigger: z.string().min(1).max(120), triggerDetail: z.string().max(120).optional(), action: z.string().min(1).max(120), actionDetail: z.string().max(120).optional(), scope: z.string().min(1).max(120), enabled: z.boolean().optional(), schedule: scheduleSchema.optional(), actionType: z.enum(['feature_brief', 'claude_prompt', 'pi_prompt', 'create_high_priority_todo']).optional(), projectPath: z.string().min(1).max(4096).optional(), instruction: z.string().min(1).max(4000).optional().describe('actionType=claude_prompt 或 pi_prompt 时必填，由对应 Agent 在 projectPath 中自主完成。') },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
}, async (input) => execute(() => store.create(input)))

server.registerTool('koala_update_automation', {
  title: '更新 Koala 自动化', description: '更新一条自动化的名称、触发条件、动作、作用范围或计划。schedule 传 null 可取消计划。',
  inputSchema: { id: z.string().min(1), name: z.string().min(1).max(120).optional(), description: z.string().max(500).optional(), trigger: z.string().min(1).max(120).optional(), triggerDetail: z.string().max(120).optional(), action: z.string().min(1).max(120).optional(), actionDetail: z.string().max(120).optional(), scope: z.string().min(1).max(120).optional(), schedule: scheduleSchema.nullable().optional(), actionType: z.enum(['feature_brief', 'claude_prompt', 'pi_prompt', 'create_high_priority_todo']).optional(), projectPath: z.string().min(1).max(4096).nullable().optional(), instruction: z.string().min(1).max(4000).nullable().optional() },
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
  title: '创建 Koala 待办', description: '创建一条待办，可指定看板类型和类型内位置，也可标记重点或关联已有项目和会话。columnId 默认 backlog，position 默认 0。',
  inputSchema: { title: z.string().min(1).max(100), important: z.boolean().optional(), columnId: todoColumnIdSchema.optional(), position: todoPositionSchema.optional(), projectId: z.string().min(1).optional(), sessionId: z.string().min(1).optional(), sessionTitle: z.string().max(200).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
}, async (input) => execute(() => todoStore.create(input)))

server.registerTool('koala_update_todo', {
  title: '更新 Koala 待办', description: '更新待办内容、完成状态、重点标记、看板位置或关联信息。移动多个待办时优先使用 koala_reorder_todos。至少提供一个待更新字段。',
  inputSchema: { id: z.string().min(1), title: z.string().min(1).max(100).optional(), done: z.boolean().optional(), important: z.boolean().optional(), columnId: todoColumnIdSchema.optional(), position: todoPositionSchema.optional(), projectId: z.string().optional(), sessionId: z.string().optional(), sessionTitle: z.string().max(200).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, async ({ id, ...input }) => execute(() => todoStore.update(id, input)))

server.registerTool('koala_reorder_todos', {
  title: '排序 Koala 待办', description: '批量移动或排序待办。请传入受影响类型内的全部待办，并为每个类型提供从 0 开始且连续的位置，以免产生重复位置。',
  inputSchema: { items: z.array(z.object({ id: z.string().min(1), columnId: todoColumnIdSchema, position: todoPositionSchema })).min(1).max(100) },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, async ({ items }) => execute(() => todoStore.reorder(items)))

server.registerTool('koala_set_todo_done', {
  title: '完成或恢复 Koala 待办', description: '把指定待办标为已完成或未完成。', inputSchema: { id: z.string().min(1), done: z.boolean() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
}, async ({ id, done }) => execute(() => todoStore.setDone(id, done)))

server.registerTool('koala_delete_todo', {
  title: '删除 Koala 待办', description: '删除指定待办。请先确认 ID。', inputSchema: { id: z.string().min(1) },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
}, async ({ id }) => execute(async () => { await todoStore.delete(id); return { id, deleted: true } }))

const HTTP_MCP_PORT = 29736
const HTTP_MCP_PATH = '/mcp'

async function startHttpServer(): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  await server.connect(transport)

  const httpServer = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (path !== HTTP_MCP_PATH) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('Not Found')
      return
    }

    void transport.handleRequest(request, response).catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : '无法处理 Koala 自动化 MCP 请求。'}\n`)
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }))
      }
    })
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(HTTP_MCP_PORT, '127.0.0.1', () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  process.stderr.write(`Koala automation MCP listening at http://127.0.0.1:${HTTP_MCP_PORT}${HTTP_MCP_PATH}\n`)
  const close = (): void => {
    void transport.close().finally(() => httpServer.close())
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}

const transportPromise = process.env.KOALA_MCP_TRANSPORT === 'http'
  ? startHttpServer()
  : server.connect(new StdioServerTransport())

void transportPromise.catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : '无法启动 Koala 自动化 MCP 服务。'}\n`)
  process.exitCode = 1
})
