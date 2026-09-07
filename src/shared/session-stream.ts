import type { AcpMessageEvent, AgentState, ChatMessage, LoadedSession, SessionTarget } from './acp'
import { mergeChatMessage } from './chat-messages'

export type SessionEvent = { type: 'state'; value: AgentState } | { type: 'message'; value: AcpMessageEvent }
export interface SessionView {
  target: SessionTarget
  state: AgentState
  messages: ChatMessage[]
  revision: number
}

export function matchesSession(target: SessionTarget, event: Partial<SessionTarget>): boolean {
  return target.sessionId === event.sessionId && target.cwd === event.cwd && target.currentAgent === event.currentAgent
}

export function applySessionEvent(view: SessionView, event: SessionEvent): SessionView {
  if (!matchesSession(view.target, event.value) || (event.value.revision ?? 0) <= view.revision) return view
  return {
    ...view,
    revision: event.value.revision!,
    ...(event.type === 'message'
      ? { messages: mergeChatMessage(view.messages, event.value.message) }
      : { state: event.value })
  }
}

/** Replay only events newer than the snapshot, including those arriving before IPC resolves. */
export function restoreSessionView(target: SessionTarget, snapshot: LoadedSession, buffered: SessionEvent[]): SessionView {
  const view: SessionView = {
    target,
    messages: snapshot.messages,
    state: snapshot.state ?? { status: 'ready', ...target },
    revision: snapshot.revision ?? 0
  }
  return buffered.reduce(applySessionEvent, view)
}
