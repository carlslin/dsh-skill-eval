import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { aggregate } from '../lib/score.js'
import { createAnalyzer } from '../lib/report.js'
import { renderHtml } from '../lib/render.js'
import { staticProfile } from '../lib/score.js'

const ctx = { on() {}, skills: { list: async () => [], get: async () => null } }

async function withAnalyzer(records, config, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sev-audit-'))
  await writeFile(path.join(dir, 'events.jsonl'), records.map((record) => JSON.stringify(record)).join('\n') + '\n')
  try {
    return await fn(createAnalyzer(ctx, { dataDir: dir, ...config }), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a telemetry key named __proto__ cannot pollute Object.prototype or crash the report', async () => {
  const mcp = JSON.parse('{"__proto__":{"calls":1,"errors":0,"samples":[1],"tools":{}}}')
  const stats = aggregate([{ ok: true, at: 1, window: { toolCalls: 1, errors: 0, mcp } }])
  assert.equal(Object.prototype.calls, undefined)
  assert.ok(stats.mcp)
  const records = [
    { t: 'skill', v: 1, at: 1000, sessionId: 's', callId: 'c', skill: 'sk', ok: true, windowId: 'w' },
    {
      t: 'window',
      v: 1,
      at: 1100,
      windowId: 'w',
      sessionId: 's',
      skill: 'sk',
      toolCalls: 1,
      errors: 0,
      mcp,
      corrections: [],
      otherSkills: [],
      turnEnded: true,
    },
  ]
  await withAnalyzer(records, {}, async (analyzer) => {
    const report = await analyzer.build()
    assert.equal(report.skills.length, 1)
    assert.equal(Object.prototype.calls, undefined)
  })
})

test('each skill ships a bounded per-load score trend for the sparkline', async () => {
  const records = []
  for (let i = 0; i < 3; i += 1) {
    records.push({
      t: 'skill',
      v: 1,
      at: 1000 + i,
      sessionId: 's',
      callId: 'c' + i,
      skill: 'sk',
      ok: true,
      windowId: 'w' + i,
    })
    records.push({
      t: 'window',
      v: 1,
      at: 1100 + i,
      windowId: 'w' + i,
      sessionId: 's',
      skill: 'sk',
      toolCalls: 4,
      errors: i === 0 ? 2 : 0,
      corrections: [],
      otherSkills: [],
      turnEnded: true,
    })
  }
  await withAnalyzer(records, {}, async (analyzer) => {
    const entry = (await analyzer.build()).skills[0]
    assert.ok(Array.isArray(entry.trend))
    assert.equal(entry.trend.length, 3)
    for (const point of entry.trend) assert.ok(Number.isFinite(point.total))
  })
})

test('report exposes scored loop steps and turn summaries', async () => {
  const records = [
    { t: 'step', v: 1, at: 1000, sessionId: 's', turn: 1, step: 1, toolCalls: 2, errors: 0 },
    { t: 'step', v: 1, at: 1100, sessionId: 's', turn: 1, step: 2, toolCalls: 3, errors: 1 },
    { t: 'step', v: 1, at: 2000, sessionId: 's', turn: 2, step: 1, toolCalls: 1, errors: 0 },
  ]
  await withAnalyzer(records, {}, async (analyzer) => {
    const report = await analyzer.build()
    assert.equal(report.steps.length, 3)
    assert.equal(report.steps[0].score.total, 100)
    assert.equal(report.steps[1].score.total, 80)
    assert.equal(report.stepOverall.steps, 3)
    assert.equal(report.stepTurns.length, 2)
    assert.equal(report.stepTurns[0].turn, 2)
  })
})

test('cumulative window snapshots do not double-count run counters', async () => {
  const records = [
    { t: 'skill', v: 1, at: 1000, sessionId: 's1', callId: 'c1', skill: 'sk', ok: true, windowId: 'w1' },
    {
      t: 'window',
      v: 1,
      at: 1500,
      windowId: 'w1',
      sessionId: 's1',
      skill: 'sk',
      toolCalls: 3,
      errors: 1,
      corrections: [],
      otherSkills: [],
      turnEnded: true,
      tokens: { input: 100, output: 50, calls: 1 },
    },
    {
      t: 'window',
      v: 1,
      at: 2000,
      windowId: 'w1',
      sessionId: 's1',
      skill: 'sk',
      toolCalls: 3,
      errors: 1,
      corrections: ['no'],
      otherSkills: [],
      turnEnded: true,
      tokens: { input: 100, output: 50, calls: 1 },
    },
  ]
  await withAnalyzer(records, {}, async (analyzer) => {
    const report = await analyzer.build()
    const run = report.runs[0]
    assert.equal(run.closed, 1)
    assert.equal(run.toolCalls, 3)
    assert.equal(run.errors, 1)
    assert.equal(run.tokens, 150)
    assert.equal(run.closed, report.totals.closed)
  })
})

test('the 95% interval uses the same scoring options as the point estimate', async () => {
  const records = []
  for (let i = 0; i < 4; i += 1) {
    records.push({
      t: 'skill',
      v: 1,
      at: 1000 + i,
      sessionId: 's',
      callId: 'c' + i,
      skill: 'sk',
      ok: true,
      windowId: 'w' + i,
    })
    records.push({
      t: 'window',
      v: 1,
      at: 1100 + i,
      windowId: 'w' + i,
      sessionId: 's',
      skill: 'sk',
      toolCalls: 1,
      errors: 0,
      corrections: [],
      otherSkills: [],
      turnEnded: true,
      tokens: { input: 10000, output: 0, cacheRead: 0, calls: 1 },
    })
  }
  await withAnalyzer(records, { tokenBudgetPerLoad: 1000, cacheReadWeight: 1, ciResamples: 100 }, async (analyzer) => {
    const score = (await analyzer.build()).skills[0].score
    assert.ok(score.ci, 'interval exists')
    assert.ok(score.ci.low <= score.total && score.total <= score.ci.high, 'score inside its interval')
  })
})

test('the skill body is not persisted or returned in reports', async () => {
  const body = `# skill\n${'x'.repeat(200_000)}`
  const profile = staticProfile({ name: 'sk', description: 'Use when x', whenToUse: 'x' }, { content: body })
  assert.equal('content' in profile, false)
  const records = [
    { t: 'skill', v: 1, at: 1000, sessionId: 's', callId: 'c', skill: 'sk', ok: true, windowId: 'w' },
    { t: 'static', v: 1, at: 1000, skill: 'sk', static: profile },
    {
      t: 'window',
      v: 1,
      at: 1100,
      windowId: 'w',
      sessionId: 's',
      skill: 'sk',
      toolCalls: 1,
      errors: 0,
      corrections: [],
      otherSkills: [],
      turnEnded: true,
    },
  ]
  await withAnalyzer(records, {}, async (analyzer) => {
    const report = await analyzer.build()
    assert.equal(JSON.stringify(report).includes('x'.repeat(500)), false)
    assert.ok(JSON.stringify(report).length < 100_000)
  })
})

test('an evicted window is censored, not scored as an abandoned run', () => {
  const stats = aggregate([
    { ok: true, at: 1, window: { toolCalls: 0, errors: 0, corrections: [], otherSkills: [], closeReason: 'evicted' } },
  ])
  assert.equal(stats.abandonRate, null)
  assert.equal(stats.closed, 1)
})

test('a malformed edit timestamp cannot 500 the HTML board', () => {
  const report = {
    generatedAt: new Date().toISOString(),
    dataDir: '/data',
    totals: { invocations: 0, skills: 0, closed: 0, open: 0, storeError: null },
    scoring: { weightsPercent: {}, thresholds: {}, minSamples: 3 },
    ranking: { significant: true },
    validity: {
      coverage: { skills: 0, withCI: 0, provisional: 0, actionable: 0 },
      ranking: { significant: false },
      canSay: [],
      cannotSay: [],
    },
    edits: [{ at: 'not-a-date', skill: 'sk', dimension: 'static', verdict: 'accept' }],
    mcpServers: [],
    mcpAdvice: [],
    runs: [],
    skills: [],
  }
  assert.doesNotThrow(() => renderHtml(report, { lang: 'zh', base: '/skill-eval' }))
})
