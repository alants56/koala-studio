export const SESSION_ACTIVITY_EVENT = 'koala:session-activity'

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
