const PALETTE = ['#5273cf', '#4f9dba', '#4460ae', '#7089d9', '#3f9b68', '#2d7e73', '#6756a5', '#737a86']

/** 根据名称稳定生成一个头像底色，避免在数据里存储颜色字段。 */
export function avatarColor(name: string): string {
  let hash = 0
  for (const char of name) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0
  }
  return PALETTE[hash % PALETTE.length]
}
