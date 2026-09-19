/** 去掉 Electron IPC 的包装前缀，得到可以直接展示给用户的错误文案。 */
export function readableIpcError(error: unknown, fallback = '操作失败'): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '').trim() || fallback
}
