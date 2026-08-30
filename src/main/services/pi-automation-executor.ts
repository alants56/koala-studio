import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'
import type { ClientConnection, SessionNotification } from '@agentclientprotocol/sdk'
import type { Automation, AutomationRunLogLevel } from '../../shared/automations'
import type { AutomationExecutionResult } from './feature-brief'
import { piAcpEnvironment } from './pi-runtime'

const EXECUTION_TIMEOUT_MS = 30 * 60 * 1000

/** Runs one scheduled instruction in an isolated Pi ACP session. */
export async function executePiInstruction(
  automation: Automation,
  log: (message: string, level?: AutomationRunLogLevel) => void
): Promise<AutomationExecutionResult> {
  const cwd = automation.projectPath?.trim()
  const instruction = automation.instruction?.trim()
  if (!cwd) throw new Error('Pi 定时任务缺少项目文件夹。')
  if (!instruction) throw new Error('Pi 定时任务缺少自定义指令。')

  let agentProcess: ChildProcessWithoutNullStreams | undefined
  let connection: ClientConnection | undefined
  let sessionId: string | undefined
  let timeout: NodeJS.Timeout | undefined
  const responseParts: string[] = []
  const toolTitles = new Map<string, string>()

  const handleUpdate = (notification: SessionNotification): void => {
    if (!sessionId || notification.sessionId !== sessionId) return
    const update = notification.update
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      responseParts.push(update.content.text)
    } else if (update.sessionUpdate === 'tool_call') {
      toolTitles.set(update.toolCallId, update.title)
      log(`Pi 调用工具：${update.title}`)
    } else if (update.sessionUpdate === 'tool_call_update') {
      const title = update.title ?? toolTitles.get(update.toolCallId) ?? '未命名工具'
      if (update.title) toolTitles.set(update.toolCallId, update.title)
      if (update.status === 'completed') log(`工具执行完成：${title}`, 'success')
      if (update.status === 'failed') log(`工具执行失败：${title}`, 'error')
    }
  }

  try {
    log('启动独立 Pi 会话')
    const adapterPath = require.resolve('pi-acp/dist/index.js')
    agentProcess = spawn(process.execPath, [adapterPath], {
      cwd,
      env: piAcpEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe']
    })
    // 子进程异常退出后仍可能收到一次写入（如关闭通知），未监听会变成未捕获的 EPIPE 异常。
    agentProcess.on('error', () => undefined)
    agentProcess.stdin.on('error', () => undefined)

    const stream = acp.ndJsonStream(
      Writable.toWeb(agentProcess.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(agentProcess.stdout) as ReadableStream<Uint8Array>
    )
    const client = acp
      .client({ name: 'Koala Studio Automation' })
      .onRequest(acp.methods.client.session.requestPermission, (context) => {
        const allowOnce = context.params.options.find((option) => option.kind === 'allow_once')
        const title = context.params.toolCall.title ?? '工具操作'
        if (!allowOnce) {
          log(`权限请求被拒绝：${title}`, 'error')
          return { outcome: { outcome: 'cancelled' as const } }
        }
        log(`允许本次工具操作：${title}`)
        return { outcome: { outcome: 'selected' as const, optionId: allowOnce.optionId } }
      })
      .onNotification(acp.methods.client.session.update, (context) => handleUpdate(context.params))

    connection = client.connect(stream)
    await connection.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {}
    })
    const session = await connection.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] })
    sessionId = session.sessionId
    log('Pi 会话已就绪', 'success')
    log('发送自定义指令')

    const prompt = [
      '你正在执行 Koala Studio 的定时自动化任务。',
      `工作目录：${cwd}`,
      '请自主完成下面的指令。需要使用工具时直接执行；不要等待用户追加信息。',
      '完成后用 Markdown 简要说明完成内容、修改的文件和验证结果。',
      '',
      instruction
    ].join('\n')
    const response = await Promise.race([
      connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text: prompt }]
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Pi 执行超过 30 分钟，任务已终止。')), EXECUTION_TIMEOUT_MS)
      })
    ])
    if (response.stopReason !== 'end_turn') throw new Error(`Pi 未正常完成任务（${response.stopReason}）。`)

    const content = responseParts.join('').trim() || 'Pi 已完成指令，但没有返回文本结果。'
    log('Pi 已返回最终结果', 'success')
    return {
      summary: 'Pi 已完成自定义指令',
      detail: '完整回复已保存到本次运行结果。',
      output: { title: `${automation.name} · Pi 结果`, content, format: 'markdown' }
    }
  } catch (error) {
    if (connection && sessionId) {
      await connection.agent.notify(acp.methods.agent.session.cancel, { sessionId }).catch(() => undefined)
    }
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    connection?.close()
    agentProcess?.kill()
  }
}
