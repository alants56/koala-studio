export const SESSION_ACTIVITY_EVENT = 'koala:session-activity'
export const SESSION_META_CHANGE_EVENT = 'koala:session-meta-change'

export interface SessionActivityDetail {
  cwd: string
  sessionId: string
  title: string
}

export function dispatchSessionActivity(detail: SessionActivityDetail): void {
  window.dispatchEvent(new CustomEvent<SessionActivityDetail>(SESSION_ACTIVITY_EVENT, { detail }))
}

export function subscribeSessionActivity(listener: (detail: SessionActivityDetail) => void): () => void {
  const handleActivity = (event: Event): void => {
    listener((event as CustomEvent<SessionActivityDetail>).detail)
  }
  window.addEventListener(SESSION_ACTIVITY_EVENT, handleActivity)
  return () => window.removeEventListener(SESSION_ACTIVITY_EVENT, handleActivity)
}

/** 会话元数据（标题 / 归档 / 删除）在设置弹窗里被改动后，通知侧栏重新读取该目录的会话。 */
export interface SessionMetaChangeDetail {
  cwd: string
}

export function dispatchSessionMetaChange(detail: SessionMetaChangeDetail): void {
  window.dispatchEvent(new CustomEvent<SessionMetaChangeDetail>(SESSION_META_CHANGE_EVENT, { detail }))
}

export function subscribeSessionMetaChange(listener: (detail: SessionMetaChangeDetail) => void): () => void {
  const handleChange = (event: Event): void => {
    listener((event as CustomEvent<SessionMetaChangeDetail>).detail)
  }
  window.addEventListener(SESSION_META_CHANGE_EVENT, handleChange)
  return () => window.removeEventListener(SESSION_META_CHANGE_EVENT, handleChange)
}
