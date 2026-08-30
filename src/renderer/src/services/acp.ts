import type { AcpApi } from '@shared/acp'

const REQUIRED_METHODS: ReadonlyArray<keyof AcpApi> = [
  'getState',
  'connect',
  'prompt',
  'removeQueuedPrompt',
  'steerQueuedPrompt',
  'stop',
  'setMode',
  'setModel',
  'setEffort',
  'setAgent',
  'listSessions',
  'loadSession',
  'createSession',
  'respondPermission',
  'onState',
  'onMessage'
]

/**
 * 校验 preload 注入的 ACP 桥接是否完整。
 * preload 变更需要重启 Electron 才会生效，旧实例可能出现缺少新方法的情况。
 */
export function assertAcpApi(): void {
  const api = window.acp as Partial<Record<keyof AcpApi, unknown>> | undefined
  const missing = REQUIRED_METHODS.filter((method) => typeof api?.[method] !== 'function')
  if (missing.length > 0) {
    throw new Error(
      `ACP 桥接缺少方法（${missing.join('、')}）。这通常是旧版本 preload 未重新加载导致，请完全退出应用后重新启动。`
    )
  }
}

/** 渲染进程访问主进程 ACP 能力的唯一入口（由 preload 注入）。 */
export const acp: AcpApi = window.acp
