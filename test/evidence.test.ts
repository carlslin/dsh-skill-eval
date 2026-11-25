import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventStore, foldSamples } from '../src/lib/store.ts'
import { createRecorder } from '../src/lib/recorder.ts'
import { aggregate, scoreSkill, staticProfile } from '../src/lib/score.ts'
import { buildAdvice } from '../src/lib/advice.ts'
import { editImpactOf } from '../src/lib/report.ts'
import type { WindowRecord } from '../src/lib/types.ts'
import type { FoldedSample } from '../src/lib/store.ts'
import type { Fn } from './helpers.ts'
import type { Fake } from './helpers.ts'

function fakeCtx() {
  const handlers = new Map<string, Fn[]>()
  return {
    on(name: string, fn: Fn) {
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
    emit(name: string, ...args: unknown[]) {
      for (const fn of handlers.get(name) ?? []) fn(...args)
      return undefined
    },
  }
}

async function tempStore() {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-evidence-'))
  return { dir, store: new EventStore(dir) }
}

async function settle(store: EventStore) {
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

const agent = { id: 'session-1' }

function loadSkill(ctx: ReturnType<typeof fakeCtx>, name: string, callId: string) {
  const call = { callId, name: 'skill', arguments: { name }, agent }
  ctx.emit('tools/pre-execute', call, () => 'next')
  ctx.emit('tools/result', call, { isError: false, value: { content: '# ' + name }, content: [] })
}

function sessionEvent(ctx: ReturnType<typeof fakeCtx>, type: string, data: Fake) {
  ctx.emit('session/event', { id: 'session-1' }, { type, data })
}

test('durable evidence events are attributed to the open skill window', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(
    ctx,
    { windowToolCalls: 12, windowTtlMs: 60_000 },
    {
      store,
      resolveSkill: async () => ({
        summary: { name: 'pdf-tools', description: 'Use when converting PDFs.' },
        definition: { content: '# PDF tools' },
      }),
    },
  )
  try {
    loadSkill(ctx, 'pdf-tools', 'c1')
    sessionEvent(ctx, 'assistant/message', {
      message: { id: 'msg-1', source: { provider: 'deepseek', model: 'v4' } },
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0 },
    })
    // The same message is rated twice: the edit replaces the rating instead of
    // double-counting it.
    sessionEvent(ctx, 'feedback/message-put', {
      sessionId: 'session-1',
      item: { messageId: 'msg-1', rating: 'negative', category: 'wrong-output' },
    })
    sessionEvent(ctx, 'feedback/message-put', {
      sessionId: 'session-1',
      item: { messageId: 'msg-1', rating: 'positive', category: 'good' },
    })
    sessionEvent(ctx, 'deliverables/presented', { files: ['out.pdf'] })
    sessionEvent(ctx, 'workspace/changes', { turn: 1 })
    sessionEvent(ctx, 'job/settled', { status: 'succeeded' })
    sessionEvent(ctx, 'approval/asked', { id: 'a1', toolName: 'bash' })
    sessionEvent(ctx, 'approval/decided', { id: 'a1', outcome: 'denied' })
    sessionEvent(ctx, 'approval/asked', { id: 'a2', toolName: 'bash' })
    sessionEvent(ctx, 'approval/decided', { id: 'a2', outcome: 'denied' })
    sessionEvent(ctx, 'compaction/start', { compactionId: 'k1' })
    sessionEvent(ctx, 'model/selection', { provider: 'deepseek', model: 'v4', reasoningEffort: 'high' })
    sessionEvent(ctx, 'agent-preset/selected', { agentPreset: 'coding' })
    ctx.emit('agent/turn-stopping', { agent })

    let records = await settle(store)
    const persisted = records.filter((r) => r.t === 'window').at(-1) as Fake | undefined
    assert.ok(persisted)
    assert.deepEqual(persisted.messageIds, ['msg-1'])
    assert.equal(persisted.feedback.positive, 1)
    assert.equal(persisted.feedback.negative, 0)
    assert.equal(persisted.feedback.categories.good, 1)
    assert.equal(persisted.outcomes.deliverables, 1)
    assert.equal(persisted.outcomes.workspaceChanges, 1)
    assert.equal(persisted.outcomes.jobsSettled, 1)
    assert.equal(persisted.approvals.asked, 2)
    assert.equal(persisted.approvals.decided, 2)
    assert.equal(persisted.approvals.rejected, 2)
    assert.equal(persisted.context.compactions, 1)
    assert.equal(persisted.model.provider, 'deepseek')
    assert.equal(persisted.model.effort, 'high')
    assert.equal(persisted.model.preset, 'coding')

    // A second load opens a new window with negative feedback, so the scorer
    // and the advice rules see both ratings.
    loadSkill(ctx, 'pdf-tools', 'c2')
    sessionEvent(ctx, 'assistant/message', { message: { id: 'msg-2' }, usage: { inputTokens: 10 } })
    sessionEvent(ctx, 'feedback/message-put', {
      sessionId: 'session-1',
      item: { messageId: 'msg-2', rating: 'negative', category: 'wrong-output', note: 'header survived' },
    })
    sessionEvent(ctx, 'compaction/start', { compactionId: 'k2' })
    ctx.emit('agent/turn-stopping', { agent })

    records = await settle(store)
    // A window is persisted at turn end and again when it closes; the reader
    // keeps the last record per windowId.
    const windows = [...new Map(records.filter((r) => r.t === 'window').map((r) => [r.windowId, r])).values()]
    assert.equal(windows.length, 2)
    const folded = foldSamples(records)
    assert.equal(folded.length, 1)
    const samples = folded[0].samples
    assert.equal(samples.length, 2)
    const stats = aggregate(samples)
    assert.equal(stats.feedbackTotal, 2)
    assert.equal(stats.feedback.positive, 1)
    assert.equal(stats.feedback.negative, 1)
    assert.equal(stats.feedbackNegativeRate, 0.5)
    assert.equal(stats.approvals.rejected, 2)
    assert.equal(stats.compactions, 2)
    assert.equal(stats.models['deepseek/v4'], 2)
    assert.equal(stats.presets.coding, 2)
    // Effectiveness alone: 100 - 50*0.5 (negative feedback) + 8*0.5 (outcome)
    // - 25*0.5 (the second window produced nothing and used no tools) = 66.5.
    const scored = scoreSkill({
      stats,
      static: null,
      weights: { static: 0, reliability: 0, effectiveness: 1, efficiency: 0 },
      minSamples: 1,
    })
    assert.equal(scored.dimensions.effectiveness, 66.5)

    const advice = buildAdvice({
      stats,
      windows: samples.map((s) => s.window).filter((w) => w !== null) as WindowRecord[],
      minSamples: 1,
    })
    const ids = advice.map((item) => item.id)
    assert.ok(ids.includes('negative-feedback'))
    assert.ok(ids.includes('approval-friction'))
    assert.ok(ids.includes('context-compaction'))
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

test('static profile judges the rendered catalog description, not raw frontmatter', () => {
  const long = 'Use when converting PDFs. ' + 'x'.repeat(700)
  const profile = staticProfile(
    { name: 'pdf-tools', description: long, invocation: { modelInvocable: true } },
    { content: '# PDF tools' },
    {},
  )
  assert.ok(profile)
  assert.equal(profile.catalogTruncated, true)
  assert.equal(profile.catalogDescription.length, 500)
  const truncated = profile.checks.find((check) => check.id === 'catalog-truncated')
  assert.ok(truncated)
  assert.equal(truncated.fraction, 0)
  assert.equal(
    profile.checks.some((check) => check.id === 'when-to-use'),
    false,
  )

  // A captured catalog string is used verbatim.
  const captured = staticProfile(
    { name: 'pdf-tools', description: long },
    { content: '# PDF tools' },
    { catalogDescription: 'short rendered text' },
  )
  assert.ok(captured)
  assert.equal(captured.catalogDescription, 'short rendered text')
  assert.equal(captured.catalogTruncated, true)

  // A user-only skill never enters the model catalog: trigger language cannot
  // route the model, so that check is skipped instead of scored zero.
  const userOnly = staticProfile(
    { name: 'pdf-tools', description: 'Short', invocation: { modelInvocable: false } },
    { content: '# PDF tools' },
    {},
  )
  assert.ok(userOnly)
  const trigger = userOnly.checks.find((check) => check.id === 'desc-trigger')
  assert.ok(trigger)
  assert.equal(trigger.skipped, true)
})

test('catalog incompleteness is recorded and surfaced as advice', () => {
  const profile = staticProfile(
    { name: 'pdf-tools', description: 'Use when converting PDFs.' },
    { content: '# PDF tools' },
    { catalogComplete: false },
  )
  assert.ok(profile)
  assert.equal(profile.catalogComplete, false)
  const stats = aggregate([])
  const advice = buildAdvice({ stats, static: profile, minSamples: 1 })
  const ids = advice.map((item) => item.id)
  assert.ok(ids.includes('catalog-incomplete'))
})
test('catalog completeness from resolveSkill reaches the static record', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(
    ctx,
    { windowToolCalls: 12 },
    {
      store,
      resolveSkill: async () => ({
        summary: { name: 'pdf-tools', description: 'Use when converting PDFs.' },
        definition: { content: '# PDF tools' },
        catalogComplete: false,
      }),
    },
  )
  try {
    loadSkill(ctx, 'pdf-tools', 'c1')
    const records = await settle(store)
    const stat = records.find((record) => record.t === 'static')
    assert.ok(stat)
    assert.equal((stat.static as Fake).catalogComplete, false)
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})

function samplePoint(at: number, value: number): FoldedSample {
  return { at, ok: true, turn: null, via: 'tool', window: { value } } as unknown as FoldedSample
}

function meanOf(subset: FoldedSample[]): number | null {
  if (subset.length === 0) return null
  return (
    subset.reduce((sum, sample) => sum + Number((sample.window as unknown as { value: number }).value), 0) /
    subset.length
  )
}

function fixedCi(subset: FoldedSample[]) {
  const mean = meanOf(subset)
  if (mean === null) return null
  return { level: 0.95, mean, low: mean - 2, high: mean + 2, resamples: 50, windows: subset.length }
}

test('editImpactOf splits before/after around the latest reviewed edit', () => {
  const samples = [samplePoint(1, 80), samplePoint(2, 82), samplePoint(10, 90), samplePoint(11, 92)]
  const impact = editImpactOf({
    edits: [
      { at: 5, dimension: 'static', verdict: 'accept', hypothesis: 'sharpen triggers' },
      { at: 4, dimension: 'effectiveness', verdict: 'reject' },
    ],
    samples,
    minimum: 2,
    score: meanOf,
    ci: fixedCi,
  })
  assert.ok(impact)
  assert.equal(impact.before.loads, 2)
  assert.equal(impact.after.loads, 2)
  assert.equal(impact.before.score, 81)
  assert.equal(impact.after.score, 91)
  assert.equal(impact.delta, 10)
  assert.equal(impact.dimension, 'static')
  assert.equal(impact.significant, true)
  assert.equal(impact.direction, 'improved')

  const insufficient = editImpactOf({
    edits: [{ at: 5 }],
    samples: [samplePoint(1, 80), samplePoint(6, 90)],
    minimum: 2,
    score: meanOf,
    ci: fixedCi,
  })
  assert.ok(insufficient)
  assert.equal(insufficient.significant, false)
  assert.equal(insufficient.direction, 'insufficient')
})

test('edit impact drives confirmation, regression and unmeasured advice', () => {
  const stats = aggregate([])
  const base = {
    before: { score: 80, loads: 4 },
    after: { score: 90, loads: 4 },
    delta: 10,
    significant: true,
    direction: 'improved' as const,
    dimension: 'static',
    hypothesis: 'sharpen triggers',
  }
  const improved = buildAdvice({ stats, minSamples: 2, editImpact: base }).map((item) => item.id)
  assert.ok(improved.includes('edit-improved'))
  const regressed = buildAdvice({
    stats,
    minSamples: 2,
    editImpact: { ...base, after: { score: 70, loads: 4 }, delta: -10, direction: 'regressed' as const },
  }).map((item) => item.id)
  assert.ok(regressed.includes('edit-regression'))
  const unmeasured = buildAdvice({
    stats,
    minSamples: 3,
    editImpact: {
      ...base,
      after: { score: 90, loads: 1 },
      delta: null,
      significant: false,
      direction: 'insufficient' as const,
    },
  }).map((item) => item.id)
  assert.ok(unmeasured.includes('edit-unmeasured'))
})

test('message feedback submitted after the window closed still updates it', async () => {
  const { dir, store } = await tempStore()
  const ctx = fakeCtx()
  const recorder = createRecorder(
    ctx,
    { windowToolCalls: 12, windowTtlMs: 60_000 },
    {
      store,
      resolveSkill: async () => ({
        summary: { name: 'pdf-tools', description: 'Use when converting PDFs.' },
        definition: { content: '# PDF tools' },
      }),
    },
  )
  try {
    loadSkill(ctx, 'pdf-tools', 'late-1')
    sessionEvent(ctx, 'assistant/message', {
      message: { id: 'msg-late', source: { provider: 'deepseek', model: 'v4' } },
      usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0 },
    })
    ctx.emit('agent/turn-stopping', { agent })
    // The next user message closes the window, before any rating is submitted.
    ctx.emit('agent/inbox/claimed', {
      agent,
      message: { content: [{ type: 'text', text: 'now do something else' }] },
    })
    let records = await settle(store)
    const closed = records.filter((record) => record.t === 'window').at(-1) as Fake | undefined
    assert.ok(closed)
    assert.equal(closed.closeReason, 'user-turn')
    assert.equal(closed.feedback?.positive ?? 0, 0)

    // The UI allows rating a finalized message after the next turn started.
    sessionEvent(ctx, 'feedback/message-put', {
      sessionId: 'session-1',
      item: { messageId: 'msg-late', rating: 'positive', category: 'task-result' },
    })
    records = await settle(store)
    const updated = records.filter((record) => record.t === 'window' && record.windowId === closed.windowId).at(-1) as
      Fake | undefined
    assert.ok(updated)
    assert.equal(updated.feedback?.positive, 1)
    assert.equal(updated.feedback?.categories['task-result'], 1)
    assert.equal(updated.closeReason, 'user-turn')
    const group = foldSamples(records).find((entry) => entry.skill === 'pdf-tools')
    assert.ok(group)
    const sample = group.samples.at(-1)
    assert.equal(sample?.window?.feedback?.positive, 1)
  } finally {
    await recorder.dispose()
    await rm(dir, { recursive: true, force: true })
  }
})
