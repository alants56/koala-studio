// 头像底色取中性设计系统里的强调色（tailwind 600/700 档），
// 保证白色字母在任意底色上都有足够对比度。
const PALETTE = ['#0f766e', '#b45309', '#6d28d9', '#15803d', '#0e7490', '#be123c', '#a16207', '#52525b']

/** 根据名称稳定生成一个头像底色，避免在数据里存储颜色字段。 */
export function avatarColor(name: string): string {
  let hash = 0
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
