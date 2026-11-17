import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventStore, foldSamples, resolveDataDir } from '../lib/store.js'
import { createRecorder, messageText } from '../lib/recorder.js'

function fakeCtx() {
  const handlers = new Map()
  return {
    on(name, fn) {
      const list = handlers.get(name) ?? []
      list.push(fn)
      handlers.set(name, list)
      return () => {
        handlers.set(
          name,
          (handlers.get(name) ?? []).filter((h) => h !== fn),
        )
      }
    },
    emit(name, ...args) {
      for (const fn of handlers.get(name) ?? []) fn(...args)
      return undefined
    },
  }
}

async function tempStore() {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-test-'))
  return { dir, store: new EventStore(dir) }
}

const agent = { id: 'session-1' }

function toolResult(ctx, name, args, { isError = false, error } = {}) {
  ctx.emit(
    'tools/result',
    { callId: `call-${Math.random().toString(36).slice(2)}`, name, arguments: args, agent },
    isError
      ? { isError: true, error: { message: error ?? 'boom', info: { name: 'ToolError' } }, content: [] }
      : { isError: false, value: null, content: [] },
  )
}

// Static capture resolves the catalog asynchronously, so drain both the
// microtask queue and the store's serialized write chain.
async function settle(store) {
  // Recorder writes are fire-and-forget, so wait for the queue to quiesce
  // instead of assuming a fixed number of microtask turns.
  let previous = -1
  let stable = 0
  for (let i = 0; i < 40; i += 1) {
    await store.queue
    await new Promise((resolve) => setTimeout(resolve, 5))
    const records = await store.readAll()
    if (records.length === previous) {
      stable += 1
      if (stable >= 2) return records
    } else {
      stable = 0
    }
    previous = records.length
  }
  return store.readAll()
}

test('messageText handles string, block array and missing shapes', () => {
  assert.equal(messageText({ content: 'hi' }), 'hi')
  assert.equal(
    messageText({
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ],
    }),
    'a\nb',
  )
  assert.equal(messageText({ text: 'plain' }), 'plain')
  assert.equal(messageText(undefined), '')
  assert.equal(messageText({ content: [{ type: 'image' }] }), '')
})

test('resolveDataDir honours explicit config, env override and the home default', () => {
  const prevDir = process.env.DSH_SKILL_EVAL_DIR
  const prevHome = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = '/tmp/fake-home'
    process.env.DSH_PROFILE = 'desktop'
    delete process.env.DSH_SKILL_EVAL_DIR
    assert.equal(resolveDataDir({}), '/tmp/fake-home/skill-eval/desktop')
    assert.equal(resolveDataDir({ dataDir: '~/custom' }).endsWith('/custom'), true)
    process.env.DSH_SKILL_EVAL_DIR = '/tmp/from-env'
    assert.equal(resolveDataDir({}), '/tmp/from-env')
  } finally {
    if (prevDir === undefined) delete process.env.DSH_SKILL_EVAL_DIR
    else process.env.DSH_SKILL_EVAL_DIR = prevDir
    if (prevHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = prevHome
  }
})

test('store round-trips records and survives a torn line', async () => {
  const { dir, store } = await tempStore()
  try {
    await store.append({ t: 'skill', skill: 'a' })
    await store.append({ t: 'window', windowId: 'w1' })
    const { appendFile } = await import('node:fs/promises')
    await appendFile(path.join(dir, 'events.jsonl'), '{"t":"skill","ski\n')
    const records = await store.readAll()
    assert.deepEqual(
      records.map((r) => r.t),
      ['skill', 'window'],
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('foldSamples attaches the latest window record to each load', async () => {
  const { dir, store } = await tempStore()
  try {
    await store.append({ t: 'skill', at: 1, skill: 'pdf', windowId: 'w1' })
    await store.append({ t: 'window', at: 2, windowId: 'w1', toolCalls: 5, corrections: [] })
    await store.append({ t: 'window', at: 3, windowId: 'w1', toolCalls: 5, corrections: ['不对'] })
    await store.append({ t: 'skill', at: 4, skill: 'pdf', windowId: 'w2' })
    const folded = foldSamples(await store.readAll())
    assert.equal(folded.length, 1)
    assert.equal(folded[0].skill, 'pdf')
    assert.equal(folded[0].samples.length, 2)
    assert.deepEqual(folded[0].samples[0].window.corrections, ['不对'])
    assert.equal(folded[0].samples[1].window, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('foldSamples collapses a duplicated /skill-name invocation after a reload', () => {
  const records = [
    { t: 'skill', at: 1, sessionId: 's', callId: 'm1', skill: 'a', ok: true, via: 'invocation', windowId: 's:m1' },
    { t: 'skill', at: 2, sessionId: 's', callId: 'm1', skill: 'a', ok: true, via: 'invocation', windowId: 's:m1' },
    { t: 'skill', at: 3, sessionId: 's', callId: 'c2', skill: 'a', ok: true, windowId: 's:c2' },
  ]
  const folded = foldSamples(records)
  assert.equal(folded.length, 1)
  assert.equal(folded[0].samples.length, 2)
  assert.equal(folded[0].samples.filter((sample) => sample.via === 'invocation').length, 1)
})

test('recorder captures a load, its window, the turn end and the follow-up correction', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12, windowTtlMs: 60_000 }, { store })
  try {
    const skillCall = { callId: 'c1', name: 'skill', arguments: { name: 'pdf-tools' }, agent }
    ctx.emit('tools/pre-execute', skillCall, () => 'next')
    ctx.emit('tools/result', skillCall, { isError: false, value: {}, content: [] })
    toolResult(ctx, 'read', { path: '/tmp/a' })
    toolResult(ctx, 'bash', { command: 'x' }, { isError: true, error: 'not found' })
    ctx.emit('agent/turn-stopping', { agent, turn: 1 })

    let records = await settle(store)
    assert.equal(records.filter((r) => r.t === 'skill').length, 1)
    const atTurnEnd = records.filter((r) => r.t === 'window').at(-1)
    assert.equal(atTurnEnd.toolCalls, 2)
    assert.equal(atTurnEnd.errors, 1)
    assert.deepEqual(atTurnEnd.errorNames, ['ToolError'])
    assert.equal(atTurnEnd.turnEnded, true)
    assert.equal(atTurnEnd.closeReason, 'turn-end')

    ctx.emit('agent/inbox/claimed', { agent, turn: 2, message: { content: '不对，页眉没删掉' } })
    records = await settle(store)
    const final = records.filter((r) => r.t === 'window').at(-1)
    assert.equal(final.closeReason, 'user-turn')
    assert.deepEqual(final.corrections, ['不对，页眉没删掉'])
    assert.equal(final.windowId, atTurnEnd.windowId)

    const folded = foldSamples(records)
    assert.equal(folded[0].samples[0].window.corrections.length, 1)
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a second load supersedes the first window and records the sibling', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  try {
    toolResult(ctx, 'skill', { name: 'alpha' })
    toolResult(ctx, 'read', {})
    toolResult(ctx, 'skill', { name: 'beta' })
    const records = await settle(store)
    const first = records.filter((r) => r.t === 'window')[0]
    assert.equal(first.skill, 'alpha')
    assert.equal(first.closeReason, 'superseded')
    assert.deepEqual(first.otherSkills, ['beta'])
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('window counting stops at the configured limit and marks truncation', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 3 }, { store })
  try {
    toolResult(ctx, 'skill', { name: 'alpha' })
    for (let i = 0; i < 10; i += 1) toolResult(ctx, 'read', {})
    ctx.emit('agent/turn-stopping', { agent, turn: 1 })
    const records = await settle(store)
    const w = records.filter((r) => r.t === 'window').at(-1)
    assert.equal(w.toolCalls, 3)
    assert.equal(w.truncated, true)
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a stale window is not blamed on a much later user message', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12, windowTtlMs: 60_000 }, { store })
  try {
    toolResult(ctx, 'skill', { name: 'alpha' })
    await new Promise((r) => setTimeout(r, 5))
    const realNow = Date.now
    Date.now = () => realNow() + 10 * 60_000
    try {
      ctx.emit('agent/inbox/claimed', { agent, turn: 2, message: { content: '不对' } })
    } finally {
      Date.now = realNow
    }
    const records = await settle(store)
    const w = records.filter((r) => r.t === 'window').at(-1)
    assert.equal(w.closeReason, 'stale')
    assert.deepEqual(w.corrections, [])
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a failing skill load is recorded with its error and opens no window', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  try {
    toolResult(ctx, 'skill', { name: 'ghost' }, { isError: true, error: 'ENOENT: SKILL.md' })
    // A failed load must not leave an in-memory window that turn-stopping or
    // dispose later persists as evidence.
    ctx.emit('agent/turn-stopping', { agent })
    const records = await settle(store)
    const skill = records.find((r) => r.t === 'skill')
    assert.equal(skill.ok, false)
    assert.match(skill.error, /ENOENT/)
    assert.equal(records.filter((r) => r.t === 'window').length, 0)
    await recorder.dispose()
    const after = await store.readAll()
    assert.equal(after.filter((r) => r.t === 'window').length, 0)
    assert.equal(after.filter((r) => r.t === 'skill').length, 1)
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a failing skill load does not supersede the previous skill window', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  try {
    ctx.emit('agent/pre-step', { agent, turn: 1, step: 1, messages: [] }, () => 'next')
    toolResult(ctx, 'skill', { name: 'alpha' })
    ctx.emit('agent/pre-step', { agent, turn: 1, step: 2, messages: [] }, () => 'next')
    toolResult(ctx, 'skill', { name: 'ghost' }, { isError: true, error: 'ENOENT: SKILL.md' })
    ctx.emit('agent/turn-stopping', { agent })
    const records = await settle(store)
    const windows = records.filter((r) => r.t === 'window')
    assert.equal(windows.length, 1)
    assert.equal(windows[0].skill, 'alpha')
    assert.equal(windows[0].closeReason, 'turn-end')
    assert.equal(windows[0].otherSkills.includes('ghost'), false)
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a successful load captures the static authoring profile for its agent scope', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const seen = []
  const resolveSkill = async (skillName, scopedAgent) => {
    seen.push([skillName, scopedAgent.id])
    return {
      summary: {
        name: 'pdf-tools',
        description:
          'Use when the user needs to extract, split, merge or annotate PDF files: read page text, reorder pages, fill forms.',
        whenToUse: 'Any task whose input or output is a .pdf file.',
        source: 'user-agents',
        provider: 'agents-dir',
      },
      definition: { content: '# PDF tools\n\n## Steps\n\n```bash\nx\n```\n' },
    }
  }
  createRecorder(ctx, { windowToolCalls: 12 }, { store, resolveSkill })
  try {
    const skillCall = { callId: 'c9', name: 'skill', arguments: { name: 'pdf-tools' }, agent }
    ctx.emit('tools/pre-execute', skillCall, () => 'next')
    ctx.emit('tools/result', skillCall, { isError: false, value: { content: '# PDF tools' }, content: [] })
    const records = await settle(store)
    const statics = records.filter((r) => r.t === 'static')
    assert.equal(statics.length, 1)
    assert.deepEqual(seen, [['pdf-tools', 'session-1']])
    assert.equal(statics[0].skill, 'pdf-tools')
    assert.equal(statics[0].source, 'user-agents')
    assert.ok(statics[0].static.score > 0)
    assert.equal(statics[0].static.resolved, true)
    assert.equal(statics[0].static.checks.length, 12)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a failed load records no static profile', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  let called = 0
  createRecorder(
    ctx,
    { windowToolCalls: 12 },
    {
      store,
      resolveSkill: async () => {
        called += 1
        return null
      },
    },
  )
  try {
    const skillCall = { callId: 'c10', name: 'skill', arguments: { name: 'ghost' }, agent }
    ctx.emit('tools/pre-execute', skillCall, () => 'next')
    ctx.emit('tools/result', skillCall, {
      isError: true,
      error: { message: 'skill "ghost" is unknown or no longer available', info: { name: 'ToolError' } },
      content: [],
    })
    const records = await settle(store)
    assert.equal(records.filter((r) => r.t === 'skill')[0].ok, false)
    assert.equal(records.filter((r) => r.t === 'static').length, 0)
    assert.equal(called, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('two loads inside one loop step stay open as a parallel batch', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  try {
    ctx.emit('agent/pre-step', { agent, turn: 1, step: 3 }, () => 'next')
    toolResult(ctx, 'skill', { name: 'alpha' })
    toolResult(ctx, 'skill', { name: 'beta' })
    // one piece of follow-up work serves both loads
    toolResult(ctx, 'read', { path: '/tmp/a' })
    ctx.emit('agent/turn-stopping', { agent, turn: 1 })

    await recorder.flush()
    const records = await settle(store)
    const windows = records.filter((r) => r.t === 'window')
    assert.equal(windows.length, 2)
    const bySkill = new Map(windows.map((w) => [w.skill, w]))
    assert.deepEqual(bySkill.get('alpha').otherSkills, [])
    assert.deepEqual(bySkill.get('beta').otherSkills, [])
    assert.equal(bySkill.get('alpha').toolCalls, 1)
    assert.equal(bySkill.get('beta').toolCalls, 1)
    assert.equal(bySkill.get('alpha').step, 3)
    assert.equal(bySkill.get('alpha').turnEnded, true)
    assert.equal(bySkill.get('alpha').closeReason, 'turn-end')
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a load in a later step still counts as switching away', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  try {
    ctx.emit('agent/pre-step', { agent, turn: 1, step: 3 }, () => 'next')
    toolResult(ctx, 'skill', { name: 'alpha' })
    ctx.emit('agent/pre-step', { agent, turn: 2, step: 4 }, () => 'next')
    toolResult(ctx, 'skill', { name: 'beta' })
    const records = await settle(store)
    const first = records.filter((r) => r.t === 'window')[0]
    assert.equal(first.closeReason, 'superseded')
    assert.deepEqual(first.otherSkills, ['beta'])
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('concurrent sessions keep independent windows (workflow subagents)', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  const childA = { id: 'child-a' }
  const childB = { id: 'child-b' }
  try {
    ctx.emit('agent/pre-step', { agent: childA, turn: 1, step: 1 }, () => 'next')
    ctx.emit('agent/pre-step', { agent: childB, turn: 1, step: 1 }, () => 'next')
    ctx.emit(
      'tools/result',
      { callId: 'a1', name: 'skill', arguments: { name: 'alpha' }, agent: childA },
      { isError: false, value: {}, content: [] },
    )
    ctx.emit(
      'tools/result',
      { callId: 'b1', name: 'skill', arguments: { name: 'beta' }, agent: childB },
      { isError: false, value: {}, content: [] },
    )
    ctx.emit(
      'tools/result',
      { callId: 'a2', name: 'read', arguments: {}, agent: childA },
      { isError: false, value: {}, content: [] },
    )
    ctx.emit('agent/turn-stopping', { agent: childA, turn: 1 })
    ctx.emit('agent/turn-stopping', { agent: childB, turn: 1 })
    await recorder.flush()
    const records = await settle(store)
    const skillRecords = records.filter((r) => r.t === 'skill')
    assert.equal(skillRecords.length, 2)
    assert.deepEqual(skillRecords.map((r) => r.sessionId).sort(), ['child-a', 'child-b'])
    const windows = records.filter((r) => r.t === 'window')
    const windowA = windows.find((w) => w.sessionId === 'child-a')
    const windowB = windows.find((w) => w.sessionId === 'child-b')
    assert.equal(windowA.toolCalls, 1)
    assert.equal(windowB.toolCalls, 0)
    assert.equal(windowA.turnEnded, true)
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('loop errors and retried model requests land inside the open window', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  try {
    ctx.emit('agent/pre-step', { agent, turn: 1, step: 2 }, () => 'next')
    toolResult(ctx, 'skill', { name: 'alpha' })
    ctx.emit('agent/request-error', { agent, turn: 1, step: 2, provider: 'deepseek' }, () => 'next')
    ctx.emit('agent/error', { agent, turn: 1, step: 2, error: new TypeError('loop exploded') })
    ctx.emit('agent/turn-stopping', { agent, turn: 1 })
    const records = await settle(store)
    const window = records.filter((r) => r.t === 'window').at(-1)
    assert.equal(window.loopErrors, 1)
    assert.equal(window.llmRetries, 1)
    assert.equal(window.lastLoopError, 'TypeError')
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a loop error with no window open is ignored', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  try {
    ctx.emit('agent/error', { agent, turn: 1, step: 1, error: new Error('early') })
    const records = await settle(store)
    assert.equal(records.length, 0)
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

function invocationMessage(name, id = 'msg-' + Math.random().toString(36).slice(2)) {
  return {
    id,
    role: 'user',
    source: { kind: 'skill-invocation', name, form: 'instructions' },
    content: [{ type: 'text', text: '<skill_content name="' + name + '">…</skill_content>' }],
  }
}

test('a user-typed /skill-name load is recorded even without a skill tool call', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const seen = []
  const recorder = createRecorder(
    ctx,
    { windowToolCalls: 12 },
    {
      store,
      resolveSkill: async (skillName, scopedAgent) => {
        seen.push([skillName, scopedAgent.id])
        return {
          summary: {
            name: skillName,
            description:
              'Use when the user asks for the manually invoked thing with enough trigger words to pass the length check.',
            whenToUse: 'Manual invocation.',
            source: 'user-agents',
            provider: 'filesystem',
          },
          definition: { content: '# Manual\n\n## Steps\n\n```bash\nx\n```\n' },
        }
      },
    },
  )
  try {
    ctx.emit('agent/pre-step', { agent, turn: 1, step: 1, messages: [] }, () => 'next')
    ctx.emit(
      'agent/pre-step',
      { agent, turn: 1, step: 1, messages: [invocationMessage('manual-skill', 'msg-1')] },
      () => 'next',
    )
    // the same injected message shows up on every later step: must not duplicate
    ctx.emit(
      'agent/pre-step',
      { agent, turn: 1, step: 2, messages: [invocationMessage('manual-skill', 'msg-1')] },
      () => 'next',
    )
    const records = await settle(store)
    const skills = records.filter((r) => r.t === 'skill')
    assert.equal(skills.length, 1)
    assert.equal(skills[0].skill, 'manual-skill')
    assert.equal(skills[0].via, 'invocation')
    assert.equal(skills[0].ok, true)
    assert.equal(skills[0].loadMs, undefined)
    assert.deepEqual(seen, [['manual-skill', 'session-1']])
    const statics = records.filter((r) => r.t === 'static')
    assert.equal(statics.length, 1)
    assert.equal(statics[0].source, 'user-agents')
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('ordinary user messages are not mistaken for skill invocations', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  try {
    ctx.emit(
      'agent/pre-step',
      {
        agent,
        turn: 1,
        step: 1,
        messages: [
          { id: 'm1', role: 'user', content: [{ type: 'text', text: 'just a question' }] },
          { id: 'm2', role: 'user', source: { kind: 'other' }, content: [] },
        ],
      },
      () => 'next',
    )
    const records = await settle(store)
    assert.equal(records.length, 0)
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('MCP tool calls are bucketed per server inside the window', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 20 }, { store })
  try {
    toolResult(ctx, 'skill', { name: 'alpha' })
    const call = (name, isError) => {
      const exec = { callId: 'c-' + Math.random().toString(36).slice(2), name, arguments: {}, agent }
      ctx.emit('tools/pre-execute', exec, () => 'next')
      ctx.emit(
        'tools/result',
        exec,
        isError
          ? { isError: true, error: { message: 'boom', info: { name: 'McpError' } }, content: [] }
          : { isError: false, value: {}, content: [] },
      )
    }
    call('mcp__context7__resolve-library-id', false)
    call('mcp__context7__query-docs', true)
    call('mcp__fetch__fetch', false)
    call('read', false)
    ctx.emit('agent/turn-stopping', { agent, turn: 1 })
    const records = await settle(store)
    const window = records.filter((r) => r.t === 'window').at(-1)
    assert.equal(window.toolCalls, 4)
    assert.equal(window.mcp.context7.calls, 2)
    assert.equal(window.mcp.context7.errors, 1)
    assert.equal(window.mcp.context7.tools['resolve-library-id'].calls, 1)
    assert.equal(window.mcp.context7.tools['query-docs'].errors, 1)
    assert.equal(window.mcp.fetch.calls, 1)
    assert.equal(typeof window.mcp.context7.ms, 'number')
    assert.equal(window.mcp.context7.ms >= 0, true)
    assert.equal(window.mcp.context7.samples.length, 2)
    assert.equal(
      window.mcp.context7.samples.every((n) => typeof n === 'number' && n >= 0),
      true,
    )
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('mcpOf parses server and tool names and ignores ordinary tools', async () => {
  const { mcpOf } = await import('../lib/recorder.js')
  assert.deepEqual(mcpOf('mcp__context7__query-docs'), { server: 'context7', tool: 'query-docs' })
  assert.deepEqual(mcpOf('mcp__memory'), { server: 'memory', tool: '' })
  assert.equal(mcpOf('bash'), null)
  assert.equal(mcpOf(undefined), null)
})

test('the session origin is recorded so subagent runs can be judged separately', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  const child = { id: 'child-1', session: { header: { origin: 'subagent' } } }
  try {
    ctx.emit('agent/pre-step', { agent: child, turn: 1, step: 1 }, () => 'next')
    ctx.emit(
      'tools/result',
      { callId: 'c1', name: 'skill', arguments: { name: 'alpha' }, agent: child },
      { isError: false, value: {}, content: [] },
    )
    ctx.emit('agent/turn-stopping', { agent: child, turn: 1 })
    const records = await settle(store)
    assert.equal(records.find((r) => r.t === 'skill').origin, 'subagent')
    assert.equal(records.find((r) => r.t === 'window').origin, 'subagent')
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('a skill load records the loop turn that produced it', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  try {
    ctx.emit('agent/pre-step', { agent, turn: 4, step: 2 }, () => 'next')
    toolResult(ctx, 'skill', { name: 'alpha' })
    const records = await settle(store)
    assert.equal(records.find((r) => r.t === 'skill').turn, 4)
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('real provider token usage is attributed to the open window', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  try {
    toolResult(ctx, 'skill', { name: 'alpha' })
    const session = { id: 'session-1' }
    ctx.emit('session/event', session, {
      type: 'assistant/message',
      seq: 1,
      time: 1,
      data: {
        turn: 1,
        step: 1,
        usage: { inputTokens: 300, outputTokens: 120, cacheReadTokens: 5000, totalTokens: 5420 },
      },
    })
    ctx.emit('session/event', session, {
      type: 'assistant/message',
      seq: 2,
      time: 2,
      data: {
        turn: 1,
        step: 2,
        usage: { inputTokens: 200, outputTokens: 80, cacheReadTokens: 4000, totalTokens: 4280 },
      },
    })
    // non-assistant events and other sessions are ignored
    ctx.emit('session/event', session, { type: 'tool/result', seq: 3, time: 3, data: {} })
    ctx.emit(
      'session/event',
      { id: 'other' },
      {
        type: 'assistant/message',
        seq: 4,
        time: 4,
        data: { turn: 1, step: 1, usage: { inputTokens: 999, outputTokens: 999 } },
      },
    )
    ctx.emit('agent/turn-stopping', { agent, turn: 1 })
    const records = await settle(store)
    const window = records.filter((r) => r.t === 'window').at(-1)
    assert.deepEqual(window.tokens, { input: 500, output: 200, cacheRead: 9000, calls: 2 })
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('per-MCP-tool latency samples are recorded and bounded', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
  try {
    toolResult(ctx, 'skill', { name: 'alpha' })
    const m1 = { callId: 'm1', name: 'mcp__context7__query-docs', arguments: {}, agent }
    ctx.emit('tools/pre-execute', m1, () => 'next')
    ctx.emit('tools/result', m1, { isError: false, content: [] })
    const m2 = { callId: 'm2', name: 'mcp__context7__query-docs', arguments: {}, agent }
    ctx.emit('tools/pre-execute', m2, () => 'next')
    ctx.emit('tools/result', m2, { isError: true, error: { message: 'boom', info: { name: 'McpError' } }, content: [] })
    ctx.emit('agent/turn-stopping', { agent, turn: 1 })
    const records = await settle(store)
    const window = records.filter((r) => r.t === 'window').at(-1)
    const tool = window.mcp.context7.tools['query-docs']
    assert.equal(tool.calls, 2)
    assert.equal(tool.errors, 1)
    assert.equal(Array.isArray(tool.samples), true)
    assert.equal(tool.samples.length, 2)
    assert.equal(typeof tool.ms, 'number')
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('records one per-step telemetry row with calls, errors, skills and tokens', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store, resolveSkill: async () => null })
  try {
    ctx.emit('agent/pre-step', { agent, turn: 1, step: 1 }, () => 'next')
    toolResult(ctx, 'skill', { name: 'pdf-tools' })
    toolResult(ctx, 'read', { path: 'a' }, { isError: true })
    ctx.emit(
      'session/event',
      { id: 'session-1' },
      {
        type: 'assistant/message',
        data: { usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5 } },
      },
    )
    ctx.emit('agent/pre-step', { agent, turn: 1, step: 2 }, () => 'next')
    toolResult(ctx, 'read', { path: 'b' })
    ctx.emit('agent/turn-stopping', { agent })
    const steps = (await settle(store)).filter((record) => record.t === 'step')
    assert.equal(steps.length, 2)
    assert.equal(steps[0].step, 1)
    assert.equal(steps[0].toolCalls, 2)
    assert.equal(steps[0].errors, 1)
    assert.deepEqual(steps[0].skills, ['pdf-tools'])
    assert.equal(steps[0].tokens.input, 100)
    assert.equal(steps[0].tokens.calls, 1)
    assert.equal(steps[0].closeReason, 'next-step')
    assert.equal(steps[1].step, 2)
    assert.equal(steps[1].toolCalls, 1)
    assert.equal(steps[1].closeReason, 'turn-end')
    assert.ok(steps[1].durationMs >= 0)
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
