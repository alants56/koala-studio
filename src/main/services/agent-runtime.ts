import type { AgentAdapterId } from '../../shared/acp'
import { piAcpEnvironment } from './pi-runtime'

/**
 * ACP 适配器的启动入口：claude / pi / codex 都是 stdio 服务，
 * 统一放在这里，避免各调用点重复写 require.resolve 与 env 组合。
 */
export function agentAdapterPath(agentId: AgentAdapterId): string {
  switch (agentId) {
    case 'pi':
      return require.resolve('pi-acp/dist/index.js')
    case 'codex':
      return require.resolve('@agentclientprotocol/codex-acp/dist/index.js')
    case 'claude':
      return require.resolve('@agentclientprotocol/claude-agent-acp/dist/index.js')
  }
}

/**
 * 适配器运行环境。
 * Pi 的 npm launcher 需要把 Electron 自带的 Node 暴露到 PATH；
 * 其余适配器用 `ELECTRON_RUN_AS_NODE` 直接以 Node 模式启动。
 */
export function agentAdapterEnvironment(agentId: AgentAdapterId): NodeJS.ProcessEnv {
  return agentId === 'pi'
    ? piAcpEnvironment()
    : { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
}
