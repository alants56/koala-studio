const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']

/** 根据名称稳定生成一个头像底色，避免在数据里存储颜色字段。 */
export function avatarColor(name: string): string {
  let hash = 0
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
