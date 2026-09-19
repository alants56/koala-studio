import { execFile, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { promisify } from 'node:util'
import * as acp from '@agentclientprotocol/sdk'
import type { ClientConnection, SessionNotification } from '@agentclientprotocol/sdk'
import type { AgentAdapterId } from '../../shared/acp'
import { piAcpEnvironment } from './pi-runtime'

const execFileAsync = promisify(execFile)

/** 生成提交说明是交互内的动作，超时按秒级给，不能沿用自动化的 30 分钟。 */
const GENERATE_TIMEOUT_MS = 60_000
const GIT_TIMEOUT_MS = 15_000
const GIT_MAX_BUFFER = 8 * 1024 * 1024
/** 送给模型的 diff 上限；超过就截断，提交说明不需要逐行看完整补丁。 */
const MAX_PATCH_CHARS = 12_000
/** 提交说明的字符上限，防止模型无视要求写出一整段。 */
const MAX_SUBJECT_CHARS = 200

/**
 * 读取 git 输出。
 * 统一带 `core.quotepath=false`：否则非 ASCII 文件名会被转义成 `\344\270\255` 这样的
 * 八进制串，喂给模型就是乱码。
 */
async function runGit(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: GIT_MAX_BUFFER,
    windowsHide: true,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  })
  return stdout
}

/**
 * 汇总当前工作区改动，作为生成提交说明的上下文。
 * 已跟踪文件的改动取 `diff HEAD`；未跟踪文件不在 diff 里，单独列出文件名。
 */
export async function buildCommitContext(cwd: string): Promise<string> {
  const sections: string[] = []

  const stat = await runGit(cwd, ['diff', 'HEAD', '--stat']).catch(() => '')
  if (stat.trim()) sections.push(`改动概览：\n${stat.trim()}`)

  let patch = await runGit(cwd, ['diff', 'HEAD', '--no-color', '-U1']).catch(() => '')
  if (!patch.trim()) {
    // 空仓库还没有 HEAD，退回暂存区与空树的差异。
    patch = await runGit(cwd, ['diff', '--cached', '--no-color', '-U1']).catch(() => '')
  }
  if (patch.trim()) {
    if (patch.length > MAX_PATCH_CHARS) patch = `${patch.slice(0, MAX_PATCH_CHARS)}\n…（补丁过长，已截断）`
    sections.push(`改动内容：\n${patch.trim()}`)
  }

  const untracked = await runGit(cwd, ['ls-files', '--others', '--exclude-standard']).catch(() => '')
  const untrackedPaths = untracked.split('\n').map((line) => line.trim()).filter(Boolean)
  if (untrackedPaths.length > 0) {
    sections.push(`新增（未跟踪）文件：\n${untrackedPaths.slice(0, 50).join('\n')}`)
  }

  return sections.join('\n\n')
}

/**
 * 把模型回复收敛成一行可用的提交说明：
 * 去掉代码围栏、常见前缀与项目符号、包裹引号、句末句号，并限制长度。
 */
export function sanitizeCommitMessage(raw: string): string {
  let text = raw.replace(/```[a-zA-Z]*\n?/g, '').trim()

  // 只取第一行有效内容，模型经常在说明后补一段解释。
  const firstLine = text.split('\n').map((line) => line.trim()).find(Boolean) ?? ''
  text = firstLine

  text = text.replace(/^(?:提交说明|提交信息|commit\s*message|commit)\s*[:：]\s*/i, '')
  text = text.replace(/^[-*•]\s+/, '')
  text = text.replace(/^\d+[.)]\s+/, '')
  text = text.replace(/^["'`“”‘’「」『』]+|["'`“”‘’「」『』]+$/g, '')
  text = text.replace(/[.。]\s*$/, '')
  text = text.replace(/\s+/g, ' ').trim()

  return text.length > MAX_SUBJECT_CHARS ? text.slice(0, MAX_SUBJECT_CHARS).trim() : text
}

/** 提交说明生成用的指令；强调只输出一行，避免模型附带解释。 */
const GENERATION_PROMPT = [
  '你是一个 Git 提交说明生成器。根据下面的工作区改动，写一条提交说明。',
  '要求：',
  '1. 只输出提交说明本身，不要任何解释、前后缀或 Markdown 代码块。',
  '2. 只写一行，使用中文，采用「动词 + 对象」的简洁写法（如「修复登录超时」「抽取会话头部组件」）。',
  '3. 不超过 50 个字，不要以句号结尾。',
  '',
  '改动如下：',
  ''
].join('\n')

/**
 * 起一个独立的 ACP 会话生成提交说明。
 *
 * 刻意不复用聊天用的 AcpBridge：它只有单个 activeSessionId / connection，
 * 且 activePromptId、turnGeneration、promptQueue 都假设同一时刻只有一个活跃 turn，
 * 并发 prompt 会打乱用户正在进行的那一轮。独立进程天然与之隔离，
 * 也不会向渲染层发出任何 message/state 事件。
 */
export async function generateCommitMessage(cwd: string, agent: AgentAdapterId): Promise<string> {
  if (!cwd) throw new Error('缺少工作目录')

  const context = await buildCommitContext(cwd)
  if (!context.trim()) throw new Error('当前没有可用于生成提交说明的改动')

  let agentProcess: ChildProcessWithoutNullStreams | undefined
  let connection: ClientConnection | undefined
  let sessionId: string | undefined
  let timeout: NodeJS.Timeout | undefined
  const responseParts: string[] = []

  const handleUpdate = (notification: SessionNotification): void => {
    if (!sessionId || notification.sessionId !== sessionId) return
    const update = notification.update
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      responseParts.push(update.content.text)
    }
  }

  try {
    const adapterPath = agent === 'pi'
      ? require.resolve('pi-acp/dist/index.js')
      : require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
    agentProcess = spawn(process.execPath, [adapterPath], {
      cwd,
      env: agent === 'pi' ? piAcpEnvironment() : { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    // 子进程异常退出后仍可能收到一次写入，未监听会变成未捕获的 EPIPE 异常。
    agentProcess.on('error', () => undefined)
    agentProcess.stdin.on('error', () => undefined)

    const stream = acp.ndJsonStream(
      Writable.toWeb(agentProcess.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(agentProcess.stdout) as ReadableStream<Uint8Array>
    )
    const client = acp
      .client({ name: 'Koala Studio Commit Message' })
      .onRequest(acp.methods.client.session.requestPermission, (request) => {
        // 生成提交说明只需要读 git，按允许一次放行；没有该选项就取消。
        const allowOnce = request.params.options.find((option) => option.kind === 'allow_once')
        return allowOnce
          ? { outcome: { outcome: 'selected' as const, optionId: allowOnce.optionId } }
          : { outcome: { outcome: 'cancelled' as const } }
      })
      .onNotification(acp.methods.client.session.update, (notification) => handleUpdate(notification.params))

    connection = client.connect(stream)
    await connection.agent.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {}
    })
    const session = await connection.agent.request(acp.methods.agent.session.new, { cwd, mcpServers: [] })
    sessionId = session.sessionId

    const response = await Promise.race([
      connection.agent.request(acp.methods.agent.session.prompt, {
        sessionId,
        prompt: [{ type: 'text', text: `${GENERATION_PROMPT}${context}` }]
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('生成提交说明超时，请重试')), GENERATE_TIMEOUT_MS)
      })
    ])
    if (response.stopReason !== 'end_turn') throw new Error('Agent 未能完成提交说明生成')

    const message = sanitizeCommitMessage(responseParts.join(''))
    if (!message) throw new Error('Agent 没有返回可用的提交说明')
    return message
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
