const { test } = require('node:test')
const assert = require('node:assert/strict')
const { AcpBridge } = require('../src/main/services/acp-bridge.ts')
const { AcpSessionManager } = require('../src/main/services/acp-session-manager.ts')
const { applySessionEvent, restoreSessionView } = require('../src/shared/session-stream.ts')

const cwd = '/same/project'
const target = (sessionId, path = cwd, currentAgent = 'claude') => ({ sessionId, cwd: path, currentAgent })
const tick = () => new Promise((resolve) => setImmediate(resolve))

// Exercise the real bridge's turn, tool, permission and queue code with a deterministic ACP transport.
function fixture(preferredAgent = 'claude', { history = [], startupInfo } = {}) {
  const bridges = []
  const store = new Map()
  let serial = 0
  const manager = new AcpSessionManager({
    getPreferredAgentId: async () => preferredAgent,
    setPreferredAgentId: async () => {},
    createBridge: (initialAgentId) => {
      const bridge = new AcpBridge({
        initialAgentId,
        queuedPromptStore: {
          get: async (agent, path, id) => structuredClone(store.get(JSON.stringify([agent, path, id])) ?? []),
          replace: async (agent, path, id, items) => { store.set(JSON.stringify([agent, path, id]), structuredClone(items)) }
        }
      })
      bridge.calls = []
      bridge.turns = []
      bridge.automationMcpServers = () => []
      bridge.connect = async (path) => {
        bridge.sessionCwd = path
        bridge.connection = {
          close: () => { bridge.closed = true },
          agent: {
            request: async (method, params) => {
              bridge.calls.push({ method, params })
              if (method === 'session/new') return {
                sessionId: `new-${++serial}`,
                ...(initialAgentId === 'pi' && startupInfo ? { _meta: { piAcp: { startupInfo } } } : {})
              }
              if (method === 'session/load') {
                bridge.handleSessionUpdate({ sessionId: params.sessionId, update: { sessionUpdate: 'user_message_chunk', ...(initialAgentId === 'pi' ? {} : { messageId: 'history' }), content: { type: 'text', text: `history-${params.sessionId}` } } })
                for (const update of history) bridge.handleSessionUpdate({ sessionId: params.sessionId, update })
                return {}
              }
              if (method === 'session/prompt') return new Promise((resolve) => bridge.turns.push(resolve))
              return {}
            },
            notify: async (method, params) => {
              bridge.calls.push({ method, params })
              if (method === 'session/cancel') bridge.turns.shift()?.({ stopReason: 'cancelled' })
            }
          }
        }
        bridge.setState({ status: 'ready' })
        return bridge.getState()
      }
      bridge.chunk = (text, id = initialAgentId === 'pi' ? undefined : 'shared-message-id') => bridge.handleSessionUpdate({
        sessionId: bridge.activeSessionId,
        update: { sessionUpdate: 'agent_message_chunk', ...(id === undefined ? {} : { messageId: id }), content: { type: 'text', text } }
      })
      bridge.complete = () => bridge.turns.shift()?.({ stopReason: 'end_turn' })
      bridges.push(bridge)
      return bridge
    }
  })
  return { manager, bridges, store }
}

const send = (manager, sessionId, text = 'hello', path = cwd, agent = 'claude') => manager.prompt({ text, cwd: path, target: target(sessionId, path, agent) })
const assistant = (snapshot) => snapshot.messages.filter((message) => message.role === 'assistant' && message.kind !== 'tool').map((message) => message.content).join('')

for (const agent of ['claude', 'pi']) {
  test(`${agent}: three same-directory sessions stream independently and switching never loads/cancels a live session`, async (t) => {
    const { manager, bridges } = fixture(agent)
    t.after(() => manager.dispose())
    const sessionTarget = (id) => target(id, cwd, agent)
    const sendToSession = (id, text) => send(manager, id, text, cwd, agent)
    const events = []
    manager.on('message', (event) => events.push(event))
    await Promise.all(['A', 'B', 'C'].map((id) => manager.loadSession(id, cwd)))
    const prompts = ['A', 'B', 'C'].map((id) => sendToSession(id))
    await tick()
    for (let i = 0; i < 6; i++) {
      bridges[0].chunk(`A${i}`)
      bridges[1].chunk(`B${i}`)
      bridges[2].chunk(`C${i}`)
      const selected = await manager.loadSession(['C', 'A', 'B'][i % 3], cwd)
      assert.equal(selected.state.status, 'working')
      assert.ok(selected.state.workStartedAt)
    }
    for (const [index, id] of ['A', 'B', 'C'].entries()) {
      const snapshot = await manager.loadSession(id, cwd)
      assert.equal(assistant(snapshot), Array.from({ length: 6 }, (_, i) => `${id}${i}`).join(''))
      assert.equal(bridges[index].calls.filter((call) => call.method === 'session/load').length, 1)
      assert.equal(bridges[index].calls.filter((call) => call.method === 'session/cancel').length, 0)
      assert.ok(events.filter((event) => event.sessionId === id).every((event) => event.cwd === cwd && event.currentAgent === agent))
    }
    bridges.forEach((bridge) => bridge.complete())
    await Promise.all(prompts)
    await tick()
    assert.ok(manager.getSessionStates().every((state) => state.status === 'ready'))
  })

  test(`${agent}: reject a fourth runtime without interrupting three tasks, then recycle an idle slot`, async (t) => {
    const { manager, bridges } = fixture(agent)
    t.after(() => manager.dispose())
    const sessionTarget = (id) => target(id, cwd, agent)
    const sendToSession = (id, text) => send(manager, id, text, cwd, agent)
    for (const id of ['A', 'B', 'C']) await manager.loadSession(id, cwd)
    const prompts = ['A', 'B', 'C'].map((id) => sendToSession(id))
    await tick()
    await assert.rejects(manager.createSession(cwd), /最多同时运行 3/)
    assert.equal(bridges.length, 3)
    assert.ok(bridges.every((bridge) => !bridge.closed))
    await manager.stop(sessionTarget('B'))
    await prompts[1]
    await tick()
    assert.equal(manager.getState(sessionTarget('A')).status, 'working')
    assert.equal(manager.getState(sessionTarget('C')).status, 'working')
    await manager.createSession(cwd)
    assert.equal(bridges[1].closed, true)
    assert.ok(!bridges[0].closed && !bridges[2].closed)
    bridges[0].complete()
    bridges[2].complete()
    await Promise.all(prompts)
  })

  test(`${agent}: permission responses and queue operations target the originating session, not the selected one`, async (t) => {
    const { manager, bridges, store } = fixture(agent)
    t.after(() => manager.dispose())
    const sessionTarget = (id) => target(id, cwd, agent)
    const sendToSession = (id, text) => send(manager, id, text, cwd, agent)
    await manager.loadSession('A', cwd)
    await manager.loadSession('B', cwd)
    const prompts = [sendToSession('A'), sendToSession('B')]
    await tick()
    await sendToSession('A', 'queued A')
    await sendToSession('B', 'queued B')
    const permissions = bridges.map((bridge) => bridge.handlePermissionRequest({ sessionId: bridge.activeSessionId, toolCall: { title: 'same tool' }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }] }))
    await manager.loadSession('B', cwd)
    const aQueue = manager.getState(sessionTarget('A')).queuedPrompts[0]
    await manager.removeQueuedPrompt(aQueue.id, sessionTarget('A'))
    assert.equal(manager.getState(sessionTarget('A')).queueDepth, 0)
    assert.equal(manager.getState(sessionTarget('B')).queueDepth, 1)
    await manager.respondPermission('allow', sessionTarget('A'))
    assert.equal((await permissions[0]).outcome.optionId, 'allow')
    assert.equal(manager.getState(sessionTarget('A')).pendingPermission, undefined)
    assert.ok(manager.getState(sessionTarget('B')).pendingPermission)
    await manager.respondPermission('allow', sessionTarget('B'))
    await permissions[1]
    bridges[0].complete()
    bridges[1].complete()
    await Promise.all(prompts)
    await tick()
    assert.equal(bridges[0].calls.filter((call) => call.method === 'session/prompt').length, 1)
    assert.equal(bridges[1].calls.filter((call) => call.method === 'session/prompt').length, 2)
    assert.equal(manager.getState(sessionTarget('B')).status, 'working')
    assert.equal(store.get(JSON.stringify([agent, cwd, 'B'])).length, 0)
    bridges[1].complete()
    await tick()
    assert.equal(manager.getState(sessionTarget('B')).status, 'ready')
  })

}

test('concurrent opens deduplicate the same session, and identity includes directory and agent', async (t) => {
  const { manager, bridges } = fixture()
  t.after(() => manager.dispose())
  await Promise.all(Array.from({ length: 8 }, () => manager.loadSession('same-id', cwd)))
  assert.equal(bridges.length, 1)
  await manager.loadSession('same-id', '/another/project')
  await manager.setAgent('pi')
  await manager.loadSession('same-id', cwd)
  assert.equal(bridges.length, 3)
  bridges.forEach((bridge, i) => bridge.chunk(String(i)))
  const states = manager.getSessionStates()
  assert.equal(states.length, 3)
  assert.equal(manager.getState(target('same-id', cwd, 'pi')).currentAgent, 'pi')
  assert.equal(manager.getState(target('same-id')).currentAgent, 'claude')
  await assert.rejects(manager.prompt({ text: 'no target', cwd }), /会话标识/)
  await assert.rejects(manager.stop(target('missing')), /未连接/)
  await assert.rejects(manager.prompt({ text: 'wrong cwd', cwd: '/other', target: target('same-id') }), /会话标识/)
})

test('tool snapshots and delayed completion stay with their session while another task is visible', async (t) => {
  const { manager, bridges } = fixture()
  t.after(() => manager.dispose())
  await manager.loadSession('A', cwd)
  const prompt = send(manager, 'A')
  await tick()
  bridges[0].chunk('answer')
  bridges[0].handleSessionUpdate({ sessionId: 'A', update: { sessionUpdate: 'tool_call', toolCallId: 'shared-tool', title: 'test', kind: 'execute', status: 'in_progress', content: [] } })
  await manager.loadSession('B', cwd)
  bridges[0].handleSessionUpdate({ sessionId: 'A', update: { sessionUpdate: 'tool_call_update', toolCallId: 'shared-tool', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'output' } }] } })
  bridges[0].complete()
  await prompt
  await tick()
  const a = await manager.loadSession('A', cwd)
  const b = await manager.loadSession('B', cwd)
  assert.equal(a.messages.filter((message) => message.kind === 'tool').length, 1)
  assert.equal(a.messages.find((message) => message.kind === 'tool').toolStatus, 'completed')
  assert.ok(a.messages.find((message) => message.content === 'answer').finishedAt)
  assert.equal(b.messages.some((message) => message.kind === 'tool' || message.content === 'answer'), false)
})

test('snapshot handoff drops already captured deltas and other sessions, retaining late deltas and status', () => {
  const scope = target('A')
  const text = (content) => ({ id: 'm', role: 'assistant', content, createdAt: '2026-09-06T00:00:00Z' })
  const event = (sessionId, revision, content) => ({ type: 'message', value: { ...target(sessionId), revision, message: text(content) } })
  const snapshot = { sessionId: 'A', messages: [text('before')], revision: 5, state: { ...scope, status: 'working', revision: 4 } }
  let view = restoreSessionView(scope, snapshot, [
    event('A', 5, 'before'), event('B', 100, 'wrong'), event('A', 6, ' after'),
    { type: 'state', value: { ...scope, status: 'ready', revision: 7 } }
  ])
  assert.equal(view.messages[0].content, 'before after')
  assert.equal(view.state.status, 'ready')
  assert.equal(applySessionEvent(view, event('A', 6, 'duplicate')), view)
  assert.equal(applySessionEvent(view, { type: 'message', value: { ...event('A', 8, 'wrong agent').value, currentAgent: 'pi' } }), view)
  assert.equal(applySessionEvent(view, { type: 'message', value: { ...event('A', 8, 'wrong cwd').value, cwd: '/other' } }), view)
  view = applySessionEvent(view, event('A', 8, '!'))
  assert.equal(view.messages[0].content, 'before after!')
})

test('new-session snapshots retain events emitted before the renderer learns its session ID', async (t) => {
  const { manager } = fixture()
  t.after(() => manager.dispose())
  const events = []
  manager.on('state', (value) => events.push({ type: 'state', value }))
  const snapshot = await manager.createSession(cwd)
  const view = restoreSessionView(target(snapshot.sessionId), snapshot, events)
  assert.equal(view.state.status, 'ready')
  assert.equal(view.target.sessionId, snapshot.sessionId)
  assert.equal(view.revision, snapshot.revision)
})

test('eviction discards late events and reopening keeps event revisions monotonic', async (t) => {
  const { manager, bridges } = fixture()
  t.after(() => manager.dispose())
  const first = await manager.loadSession('A', cwd)
  // All sessions are idle; A is the oldest runtime and can safely be released.
  await manager.loadSession('B', cwd)
  await manager.loadSession('C', cwd)
  await manager.loadSession('D', cwd)
  assert.equal(bridges[0].closed, true)
  const events = []
  manager.on('message', (event) => events.push(event))
  bridges[0].emit('message', { id: 'late', role: 'assistant', content: 'stale', createdAt: '' })
  assert.equal(events.length, 0)
  const reopened = await manager.loadSession('A', cwd)
  assert.ok(reopened.revision > first.revision)
  assert.equal(reopened.messages.some((message) => message.content === 'stale'), false)
})

test('connection failure releases its reservation and does not poison subsequent opens', async (t) => {
  const { manager, bridges } = fixture()
  t.after(() => manager.dispose())
  const original = manager.options.createBridge
  manager.options.createBridge = (agent) => {
    const bridge = original(agent)
    bridge.connect = async () => ({ status: 'error', detail: 'test transport failed' })
    return bridge
  }
  await assert.rejects(manager.loadSession('failure', cwd), /test transport failed/)
  assert.equal(manager.getSessionStates().length, 0)
  manager.options.createBridge = original
  for (const id of ['A', 'B', 'C']) await manager.loadSession(id, cwd)
  assert.equal(manager.getSessionStates().length, 3)
  assert.equal(bridges.length, 4)
})

test('history queue resumes in the background and explicit agent identity survives selection changes', async (t) => {
  const { manager, bridges, store } = fixture()
  t.after(() => manager.dispose())
  store.set(JSON.stringify(['claude', cwd, 'A']), [{ id: 'saved', request: { text: 'resume me', cwd } }])
  await manager.setAgent('pi')
  await manager.loadSession('A', cwd, 'claude')
  await tick()
  assert.equal(manager.getState(target('A')).status, 'working')
  await manager.loadSession('B', cwd, 'pi')
  const snapshot = await manager.loadSession('A', cwd, 'claude')
  assert.equal(snapshot.state.status, 'working')
  assert.equal(snapshot.messages.filter((message) => message.content === 'resume me').length, 1)
  assert.equal(bridges[0].calls.filter((call) => call.method === 'session/load').length, 1)
  bridges[0].complete()
  await tick()
  assert.equal(manager.getState(target('A')).status, 'ready')
})

test('pi: ID-less text and thought chunks, repeated tool IDs and terminal deltas stay session-local', async (t) => {
  const { manager, bridges } = fixture('pi')
  t.after(() => manager.dispose())
  for (const id of ['A', 'B', 'C']) await manager.loadSession(id, cwd, 'pi')
  const prompts = ['A', 'B', 'C'].map((id) => send(manager, id, 'run', cwd, 'pi'))
  await tick()
  const update = (index, value) => bridges[index].handleSessionUpdate({ sessionId: ['A', 'B', 'C'][index], update: value })
  for (const [index, id] of ['A', 'B', 'C'].entries()) {
    update(index, { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: `${id}-think` } })
    bridges[index].chunk(`${id}-before`)
    update(index, { sessionUpdate: 'tool_call', toolCallId: 'same-tool-id', title: 'bash', kind: 'execute', status: 'in_progress', content: [] })
  }
  for (let part = 0; part < 3; part++) {
    for (const [index, id] of ['A', 'B', 'C'].entries()) {
      update(index, { sessionUpdate: 'tool_call_update', toolCallId: 'same-tool-id', _meta: { terminal_output: { data: `${id}${part}\n` } } })
    }
    await manager.loadSession(['C', 'A', 'B'][part], cwd, 'pi')
  }
  for (const [index, id] of ['A', 'B', 'C'].entries()) {
    update(index, { sessionUpdate: 'tool_call_update', toolCallId: 'same-tool-id', status: 'completed', _meta: { terminal_exit: { exit_code: index } } })
    bridges[index].chunk(`${id}-after`)
    bridges[index].chunk('-more')
    // A misrouted adapter notification is also rejected inside the bridge.
    bridges[index].handleSessionUpdate({ sessionId: 'foreign-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'WRONG' } } })
    bridges[index].complete()
  }
  await Promise.all(prompts)
  await tick()
  for (const [index, id] of ['A', 'B', 'C'].entries()) {
    const snapshot = await manager.loadSession(id, cwd, 'pi')
    const texts = snapshot.messages.filter((message) => message.role === 'assistant' && message.kind === 'text')
    assert.deepEqual(texts.map((message) => message.content), [`${id}-before`, `${id}-after-more`])
    assert.notEqual(texts[0].id, texts[1].id)
    assert.ok(texts[1].finishedAt)
    assert.equal(snapshot.messages.find((message) => message.kind === 'thinking').content, `${id}-think`)
    const tools = snapshot.messages.filter((message) => message.kind === 'tool')
    assert.equal(tools.length, 1)
    assert.equal(tools[0].content, `\`\`\`\`\n${id}0\n${id}1\n${id}2\n\n\`\`\`\``)
    assert.equal(tools[0].exitCode, index)
    assert.equal(tools[0].toolStatus, 'completed')
    assert.equal(snapshot.state.status, 'ready')
  }
})

test('pi: ID-less history messages are distinct and live deltas do not merge into replayed messages', async (t) => {
  const { manager, bridges } = fixture('pi', {
    history: ['first answer', 'second answer'].map((text) => ({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }))
  })
  t.after(() => manager.dispose())
  const initial = await manager.loadSession('A', cwd, 'pi')
  assert.deepEqual(initial.messages.filter((message) => message.role === 'assistant').map((message) => message.content), ['first answer', 'second answer'])
  const prompt = send(manager, 'A', 'continue', cwd, 'pi')
  await tick()
  bridges[0].chunk('live')
  await manager.loadSession('B', cwd, 'pi')
  bridges[0].chunk(' answer')
  bridges[0].complete()
  await prompt
  await tick()
  const restored = await manager.loadSession('A', cwd, 'pi')
  const messages = restored.messages.filter((message) => message.role === 'assistant')
  assert.deepEqual(messages.map((message) => message.content), ['first answer', 'second answer', 'live answer'])
  assert.equal(new Set(messages.map((message) => message.id)).size, 3)
  assert.equal(bridges[0].calls.filter((call) => call.method === 'session/load').length, 1)
})

test('pi: delayed startup notice is suppressed only in its own session after switching away', async (t) => {
  const { manager, bridges } = fixture('pi', { startupInfo: 'Pi startup information' })
  t.after(() => manager.dispose())
  const a = await manager.createSession(cwd, 'pi')
  const b = await manager.createSession(cwd, 'pi')
  const prompts = [a, b].map((session) => send(manager, session.sessionId, 'run', cwd, 'pi'))
  await tick()
  // B is visible when A's delayed startup and live chunks arrive.
  bridges[0].chunk('Pi startup information')
  bridges[0].chunk('A answer')
  bridges[1].chunk('Pi startup information')
  bridges[1].chunk('B answer')
  bridges.forEach((bridge) => bridge.complete())
  await Promise.all(prompts)
  await tick()
  assert.equal(assistant(await manager.loadSession(a.sessionId, cwd, 'pi')), 'A answer')
  assert.equal(assistant(await manager.loadSession(b.sessionId, cwd, 'pi')), 'B answer')
})

test('mixed Claude/Pi sessions with the same ID share the three-runtime limit but never share events or controls', async (t) => {
  const { manager, bridges } = fixture()
  t.after(() => manager.dispose())
  const claude = target('same-id', cwd, 'claude')
  const pi = target('same-id', cwd, 'pi')
  await manager.loadSession(claude.sessionId, cwd, 'claude')
  await manager.setAgent('pi')
  const piSnapshot = await manager.loadSession(pi.sessionId, cwd, 'pi')
  let visiblePi = restoreSessionView(pi, piSnapshot, [])
  manager.on('message', (value) => { visiblePi = applySessionEvent(visiblePi, { type: 'message', value }) })
  manager.on('state', (value) => { visiblePi = applySessionEvent(visiblePi, { type: 'state', value }) })
  const claudePrompt = send(manager, claude.sessionId)
  const piPrompt = send(manager, pi.sessionId, 'hello', cwd, 'pi')
  await tick()
  bridges[0].chunk('Claude answer', 'same-message')
  bridges[1].chunk('Pi answer', 'same-message')
  assert.equal(assistant(visiblePi), 'Pi answer')
  assert.equal(await manager.getCurrentAgent(), 'pi')
  await manager.loadSession('third', cwd, 'pi')
  const thirdPrompt = send(manager, 'third', 'run', cwd, 'pi')
  await tick()
  await assert.rejects(manager.createSession(cwd, 'claude'), /最多同时运行 3/)
  await manager.stop(pi)
  await piPrompt
  assert.equal(manager.getState(claude).status, 'working')
  assert.equal(bridges[0].calls.filter((call) => call.method === 'session/cancel').length, 0)
  bridges[0].complete()
  bridges[2].complete()
  await Promise.all([claudePrompt, thirdPrompt])
})
