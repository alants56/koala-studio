const PALETTE = ['#cc785c', '#5db8a6', '#e8a55a', '#a9583e', '#c98a6b', '#5db872', '#b59a76', '#8e8b82']

/** 根据名称稳定生成一个头像底色，避免在数据里存储颜色字段。 */
export function avatarColor(name: string): string {
  let hash = 0
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
