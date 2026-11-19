import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventStore } from '../src/lib/store.ts'
import { renderMcpMarkdown } from '../src/lib/render.ts'
import {
  bootstrapCI,
  createAnalyzer,
  normalizeWeights,
  percentWeights,
  rankingOf,
  resolveThresholds,
} from '../src/lib/report.ts'
import type { Fake, Fn } from './helpers.ts'
import type { SkillSummary } from '../src/lib/score.ts'
import { partial } from './helpers.ts'

const SKILLS = [
  {
    name: 'pdf-tools',
    description:
      'Use when the user needs to extract, split, merge or annotate PDF files: read page text, reorder pages, fill forms, export images.',
    whenToUse: 'Any task whose input or output is a .pdf file.',
    source: 'user-dsh',
    provider: 'filesystem',
    invocation: { modelInvocable: true, userInvocable: true },
  },
]

const DEFS: Record<string, { content: string }> = {
  'pdf-tools': {
    content: `# PDF

## When to use
Use for PDFs.

## Steps
1. Run \`scripts/inspect.py\`.

\`\`\`bash
python scripts/inspect.py a.pdf
\`\`\`

See references/forms.md for forms.
`,
  },
}

function fakeCtx() {
  const handlers = new Map<string, Fn[]>()
  return {
    on(name: string, fn: Fn) {
      const list = handlers.get(name) ?? []
      list.push(fn)
      handlers.set(name, list)
      return () => {}
    },
    emit(name: string, ...args: unknown[]) {
      for (const fn of handlers.get(name) ?? []) fn(...args)
    },
    skills: {
      async list(): Promise<SkillSummary[]> {
        return SKILLS
      },
      async get(name: string) {
        return DEFS[name]
      },
    },
  }
}

function record(overrides: Fake = {}) {
  return {
    t: 'skill',
    v: 1,
    at: Date.now(),
    sessionId: 's',
    callId: `c${Math.random()}`,
    skill: 'pdf-tools',
    ok: true,
    ...overrides,
  }
}

test('analyzer joins static profile, runtime evidence and advice', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-report-'))
  try {
    const store = new EventStore(dir)
    for (let i = 0; i < 3; i += 1) {
      const id = `s:c${i}`
      await store.append(record({ callId: `c${i}`, windowId: id }))
      await store.append({
        t: 'window',
        at: Date.now(),
        windowId: id,
        sessionId: 's',
        skill: 'pdf-tools',
        toolCalls: 4,
        errors: 0,
        errorNames: [],
        corrections: i === 0 ? ['不对'] : [],
        otherSkills: [],
        turnEnded: true,
        truncated: false,
        closeReason: 'user-turn',
      })
    }
    const ctx = fakeCtx()
    const analyzer = createAnalyzer(ctx, { dataDir: dir, minSamples: 3, maxAdvice: 3 })
    await store.queue
    const report = await analyzer.build()
    assert.equal(report.totals.invocations, 3)
    assert.equal(report.skills.length, 1)
    const entry = report.skills[0]
    assert.ok(entry)
    assert.equal(entry.skill, 'pdf-tools')
    assert.equal(entry.stats.loads, 3)
    assert.equal(entry.stats.closed, 3)
    assert.ok(Number(entry.staticQuality?.score) > 0)
    assert.ok(entry.staticQuality?.resolved)
    assert.ok(Number.isFinite(entry.score.total))
    assert.equal(entry.score.provisional, false)
    assert.ok(entry.advice.some((a) => a.id === 'user-corrections'))
    assert.ok(entry.topAdvice.length <= 3)

    const one = await analyzer.buildOne('pdf-tools')
    assert.ok(one)
    assert.equal(one.skill, 'pdf-tools')
    assert.equal(await analyzer.buildOne('nope'), null)

    // skills/change invalidates the static cache
    analyzer.invalidate()
    const again = await analyzer.buildOne('pdf-tools')
    assert.ok(again)
    assert.ok(Number(again.staticQuality?.score) > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('analyzer reports an unresolved skill without crashing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-report-'))
  try {
    const store = new EventStore(dir)
    await store.append(record({ skill: 'deleted-skill', callId: 'x', windowId: 's:x' }))
    await store.queue
    const ctx = fakeCtx()
    const analyzer = createAnalyzer(ctx, { dataDir: dir })
    const report = await analyzer.build()
    const entry = report.skills[0]
    assert.equal(entry.skill, 'deleted-skill')
    assert.equal(entry.staticQuality, null)
    assert.ok(entry.advice.some((a) => a.id === 'unresolved-skill'))
    // with no static dimension the remaining weights still normalise
    assert.ok(Number(entry.score.coverage) <= 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the analyzer falls back to the static profile captured at load time', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-report-'))
  try {
    const store = new EventStore(dir)
    await store.append(record({ skill: 'scoped-only', callId: 'a', windowId: 's:a' }))
    await store.append({
      t: 'static',
      v: 1,
      at: Date.now(),
      skill: 'scoped-only',
      source: 'user-agents',
      static: {
        name: 'scoped-only',
        description: 'Use when the user asks for the scoped thing with trigger words.',
        whenToUse: 'Scoped tasks only.',
        content: '# Scoped\n\n## Steps\n\nDo it.\n',
        bodyLines: 6,
        sectionCount: 1,
        source: 'user-agents',
        provider: 'agents-dir',
        resolved: true,
        checks: [],
        score: 84.5,
        failedChecks: [],
      },
    })
    await store.queue

    // The catalog is empty for this name: only the recorded profile can answer.
    const ctx = fakeCtx()
    const analyzer = createAnalyzer(ctx, { dataDir: dir })
    const entry = await analyzer.buildOne('scoped-only')
    assert.ok(entry)
    assert.ok(entry.staticQuality)
    assert.equal(entry.staticQuality.score, 84.5)
    assert.equal(entry.staticQuality.origin, 'recorded')
    assert.equal(entry.source, 'user-agents')
    assert.ok(entry.score.dimensions.static !== null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the report carries an MCP health board and per-run rows', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-report-'))
  try {
    const store = new EventStore(dir)
    const at = Date.now()
    await store.append(record({ skill: 'pdf-tools', callId: 'c1', windowId: 's:c1', sessionId: 's1', at }))
    await store.append({
      t: 'window',
      at,
      windowId: 's:c1',
      sessionId: 's1',
      skill: 'pdf-tools',
      toolCalls: 3,
      errors: 1,
      errorNames: ['McpError'],
      corrections: [],
      otherSkills: [],
      mcp: {
        context7: {
          calls: 2,
          errors: 1,
          ms: 400,
          samples: [180, 220],
          tools: { 'query-docs': { calls: 2, errors: 1 } },
        },
        fetch: { calls: 1, errors: 0, ms: 900, tools: { fetch: { calls: 1, errors: 0 } } },
      },
      turnEnded: true,
      truncated: false,
      closeReason: 'user-turn',
    })
    await store.queue
    const analyzer = createAnalyzer(fakeCtx(), { dataDir: dir, minSamples: 1 })
    const report = await analyzer.build()

    assert.equal(report.mcpServers.length, 2)
    const context7 = report.mcpServers.find((row) => row.server === 'context7')
    assert.ok(context7)
    assert.equal(context7.calls, 2)
    assert.equal(context7.errors, 1)
    assert.equal(context7.errorRate, 0.5)
    assert.equal(context7.avgMs, 200)
    assert.equal(typeof context7.p50Ms, 'number')
    assert.equal(typeof context7.p95Ms, 'number')
    assert.equal(context7.samples, 2)
    assert.ok(Number(context7.p95Ms) >= Number(context7.p50Ms))
    assert.ok(Number(context7.health) < 100)
    assert.equal(context7.health, 65)
    assert.equal(context7.grade, 'D')
    assert.equal(context7.tools[0].tool, 'query-docs')

    assert.equal(report.runs.length, 1)
    assert.equal(report.runs[0].sessionId, 's1')
    assert.equal(report.runs[0].loads, 1)
    assert.equal(report.runs[0].toolCalls, 3)
    assert.equal(report.runs[0].mcpCalls, 3)
    assert.equal(report.runs[0].mcpErrors, 1)
    // each run is scored on its own dimensions
    const runScore = report.runs[0].score
    assert.ok(runScore)
    assert.equal(typeof runScore.total, 'number')
    assert.ok(['A', 'B', 'C', 'D', 'F'].includes(runScore.grade))
    assert.equal(runScore.confidence, 'medium')
    assert.equal(typeof runScore.dimensions.quality, 'number')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('displayed weights always sum to 100 after rounding', () => {
  const weights = normalizeWeights({ static: 2, reliability: 2, effectiveness: 2, efficiency: 1 })
  const pct = percentWeights(weights)
  assert.equal(
    Object.values(pct).reduce((sum, value) => sum + value, 0),
    100,
  )
  assert.deepEqual(percentWeights(normalizeWeights()), {
    static: 30,
    reliability: 25,
    effectiveness: 30,
    efficiency: 15,
  })
})

test('normalizeWeights accepts relative and percent input', () => {
  const w = normalizeWeights({ static: 30, reliability: 25, effectiveness: 30, efficiency: 15 })
  assert.deepEqual(w, { static: 0.3, reliability: 0.25, effectiveness: 0.3, efficiency: 0.15 })
  const half = normalizeWeights({ static: 1, reliability: 1, effectiveness: 0, efficiency: 0 })
  assert.deepEqual(half, { static: 0.5, reliability: 0.5, effectiveness: 0, efficiency: 0 })
  // all-zero falls back to the defaults instead of dividing by zero
  assert.deepEqual(normalizeWeights({ static: 0, reliability: 0, effectiveness: 0, efficiency: 0 }), {
    static: 0.3,
    reliability: 0.25,
    effectiveness: 0.3,
    efficiency: 0.15,
  })
})

test('thresholds stay ordered even when typed in the wrong order', () => {
  const t = resolveThresholds({ excellent: 70, good: 95, pass: 99 })
  assert.deepEqual(t, { excellent: 99, good: 95, pass: 70 })
  // sorting must preserve the three distinct floors instead of clamping B to C
  assert.deepEqual(resolveThresholds({ excellent: 90, good: 50, pass: 70 }), {
    excellent: 90,
    good: 70,
    pass: 50,
  })
})

test('a user weight change moves the composite in the expected direction', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-report-'))
  try {
    const store = new EventStore(dir)
    const sp = {
      name: 'pdf-tools',
      description: 'Use when the user needs to extract, split, merge or annotate PDF files: read text, fill forms.',
      whenToUse: 'Any .pdf task.',
      source: 'user-dsh',
      provider: 'filesystem',
    }
    const summary = { ...sp }
    const ctx = fakeCtx()
    ctx.skills.list = async () => [partial<SkillSummary>(summary)]
    ctx.skills.get = async () => ({ content: '# PDF\n\n## Steps\n\n```bash\nx\n```\n' })

    for (let i = 0; i < 3; i += 1) {
      await store.append(record({ callId: `c${i}`, windowId: `s:c${i}` }))
      await store.append({
        t: 'window',
        at: Date.now(),
        windowId: `s:c${i}`,
        sessionId: 's',
        skill: 'pdf-tools',
        toolCalls: 4,
        errors: 0,
        errorNames: [],
        corrections: [],
        otherSkills: [],
        turnEnded: true,
        truncated: false,
        closeReason: 'user-turn',
      })
    }
    await store.queue

    const runtimeOnly = createAnalyzer(ctx, {
      dataDir: dir,
      weights: { static: 0, reliability: 50, effectiveness: 50, efficiency: 0 },
    })
    const staticHeavy = createAnalyzer(ctx, {
      dataDir: dir,
      weights: { static: 100, reliability: 0, effectiveness: 0, efficiency: 0 },
    })
    const a = (await runtimeOnly.build()).skills[0]
    const b = (await staticHeavy.build()).skills[0]
    assert.notEqual(a.score.total, b.score.total)
    assert.equal(a.score.dimensions.static, b.score.dimensions.static)
    const report = await runtimeOnly.build()
    assert.deepEqual(report.scoring.weightsPercent, { static: 0, reliability: 50, effectiveness: 50, efficiency: 0 })
    assert.equal(report.scoring.customizable, true)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('every score carries a confidence label', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-report-'))
  try {
    const store = new EventStore(dir)
    for (let i = 0; i < 10; i += 1) {
      await store.append(record({ callId: `c${i}`, windowId: `s:c${i}` }))
      await store.append({
        t: 'window',
        at: Date.now(),
        windowId: `s:c${i}`,
        sessionId: 's',
        skill: 'pdf-tools',
        toolCalls: 2,
        errors: 0,
        errorNames: [],
        corrections: [],
        otherSkills: [],
        turnEnded: true,
        truncated: false,
        closeReason: 'user-turn',
      })
    }
    await store.queue
    const analyzer = createAnalyzer(fakeCtx(), { dataDir: dir, minSamples: 3 })
    const entry = (await analyzer.build()).skills[0]
    assert.equal(entry.score.confidence, 'high')
    assert.equal(entry.score.samples, 10)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the report exposes MCP advice and honours custom MCP thresholds', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-report-'))
  try {
    const store = new EventStore(dir)
    await store.append(record({ callId: 'c1', windowId: 's:c1', sessionId: 's1' }))
    await store.append({
      t: 'window',
      at: Date.now(),
      windowId: 's:c1',
      sessionId: 's1',
      skill: 'pdf-tools',
      toolCalls: 3,
      errors: 0,
      errorNames: [],
      corrections: [],
      otherSkills: [],
      mcp: { context7: { calls: 6, errors: 2, ms: 1200, samples: [200, 200, 200, 200, 200, 200], tools: {} } },
      turnEnded: true,
      truncated: false,
      closeReason: 'user-turn',
    })
    await store.queue
    const loose = await createAnalyzer(fakeCtx(), { dataDir: dir, minSamples: 1, mcpErrorRatePercent: 50 }).build()
    assert.deepEqual(loose.mcpAdvice, [])
    const strict = await createAnalyzer(fakeCtx(), {
      dataDir: dir,
      minSamples: 1,
      mcpErrorRatePercent: 10,
    }).build()
    assert.ok(strict.mcpAdvice.some((item) => item.id === 'mcp-server-errors'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('bootstrapCI brackets the observed score and is reproducible', () => {
  const values = [60, 70, 80, 90]
  const ci = bootstrapCI(values, (draw) => draw.reduce((a, b) => a + b, 0) / draw.length, { resamples: 300, seed: 7 })
  assert.ok(ci)
  assert.ok(ci.low <= 75 && ci.high >= 75, JSON.stringify(ci))
  const again = bootstrapCI(values, (draw) => draw.reduce((a, b) => a + b, 0) / draw.length, {
    resamples: 300,
    seed: 7,
  })
  assert.deepEqual(ci, again)
  assert.equal(
    bootstrapCI([50], () => 50, { resamples: 10 }),
    null,
  )
  assert.equal(
    bootstrapCI(values, (draw) => draw.reduce((a, b) => a + b, 0) / draw.length, { resamples: 0 }),
    null,
  )
})

test('each scored skill carries a 95% interval over its loads', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-report-'))
  try {
    const store = new EventStore(dir)
    for (let i = 0; i < 6; i += 1) {
      await store.append(record({ callId: `c${i}`, windowId: `s:c${i}` }))
      await store.append({
        t: 'window',
        at: Date.now(),
        windowId: `s:c${i}`,
        sessionId: 's',
        skill: 'pdf-tools',
        toolCalls: 4,
        errors: i % 2,
        errorNames: i % 2 ? ['E'] : [],
        corrections: [],
        otherSkills: [],
        turnEnded: true,
        truncated: false,
        closeReason: 'user-turn',
      })
    }
    await store.queue
    const analyzer = createAnalyzer(fakeCtx(), { dataDir: dir, minSamples: 3, ciResamples: 120 })
    const entry = (await analyzer.build()).skills[0]
    assert.ok(entry.score.ci, 'expected a CI')
    assert.ok(entry.score.ci.low <= Number(entry.score.total))
    assert.ok(entry.score.ci.high >= Number(entry.score.total))
    assert.ok(entry.score.ci.high - entry.score.ci.low < 60, 'CI should be informative, not 0-100')
    assert.equal(entry.score.ci.resamples, 120)

    const disabled = await createAnalyzer(fakeCtx(), { dataDir: dir, minSamples: 3, ciResamples: 0 }).build()
    assert.equal(disabled.skills[0].score.ci, null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ranking is unknown, not significant, when no intervals exist', () => {
  const ranking = rankingOf([
    { skill: 'a', score: { total: 80, ci: null } },
    { skill: 'b', score: { total: 70, ci: null } },
  ])
  assert.equal(ranking.significant, null)
  assert.match(ranking.note ?? '', /not enough scored skills/)
})

test('ranking warns when two skills have overlapping intervals', () => {
  const entry = (skill: string, total: number, low: number, high: number) => ({
    skill,
    score: { total, ci: { low, high } },
  })
  assert.equal(rankingOf([]).significant, null)
  assert.equal(rankingOf([entry('a', 88, 80, 95)]).significant, null)
  const tie = rankingOf([entry('a', 88, 80, 95), entry('b', 85, 78, 92)])
  assert.equal(tie.significant, false)
  assert.equal(tie.ties.length, 1)
  assert.match(tie.note ?? '', /tie/)
  const clear = rankingOf([entry('a', 95, 92, 98), entry('b', 60, 52, 68)])
  assert.equal(clear.significant, true)
})

test('every run also carries a bootstrap interval over its windows', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-report-'))
  try {
    const store = new EventStore(dir)
    for (let i = 0; i < 4; i += 1) {
      await store.append(record({ callId: `c${i}`, windowId: `s:c${i}`, sessionId: 'run-1' }))
      await store.append({
        t: 'window',
        at: Date.now(),
        windowId: `s:c${i}`,
        sessionId: 'run-1',
        skill: 'pdf-tools',
        toolCalls: 4,
        errors: i % 2,
        errorNames: i % 2 ? ['E'] : [],
        corrections: [],
        otherSkills: [],
        turnEnded: true,
        truncated: false,
        closeReason: 'user-turn',
      })
    }
    await store.queue
    const analyzer = createAnalyzer(fakeCtx(), { dataDir: dir, minSamples: 1, ciResamples: 100 })
    const report = await analyzer.build()
    const run = report.runs[0]
    assert.ok(run.score, 'run has a score')
    assert.ok(run.score.ci, 'expected a run CI')
    assert.ok(run.score.ci.low <= Number(run.score.total) && run.score.ci.high >= Number(run.score.total))
    assert.equal(run.score.ci.resamples, 100)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('turnLoads groups skill loads by the turn that produced them', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-report-'))
  try {
    const store = new EventStore(dir)
    await store.append(record({ skill: 'alpha', callId: 'a1', windowId: 'w1', sessionId: 's1', turn: 3 }))
    await store.append(record({ skill: 'beta', callId: 'b1', windowId: 'w2', sessionId: 's1', turn: 3 }))
    await store.append(record({ skill: 'alpha', callId: 'a2', windowId: 'w3', sessionId: 's1', turn: 4 }))
    await store.append(record({ skill: 'gamma', callId: 'g1', windowId: 'w4', sessionId: 's2', turn: 1 }))
    await store.queue
    const report = await createAnalyzer(fakeCtx(), { dataDir: dir }).build()
    assert.equal(report.turnLoads.length, 3)
    const turn3 = report.turnLoads.find((row) => row.sessionId === 's1' && row.turn === 3)
    assert.ok(turn3)
    assert.deepEqual(turn3.skills.sort(), ['alpha', 'beta'])
    const turn4 = report.turnLoads.find((row) => row.sessionId === 's1' && row.turn === 4)
    assert.ok(turn4)
    assert.deepEqual(turn4.skills, ['alpha'])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the report anneals the advice budget and emits exploration directives from the ledger', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-report-'))
  try {
    const store = new EventStore(dir)
    for (let i = 0; i < 6; i += 1) {
      await store.append(record({ callId: `c${i}`, windowId: `s:c${i}` }))
      await store.append({
        t: 'window',
        at: Date.now(),
        windowId: `s:c${i}`,
        sessionId: 's',
        skill: 'pdf-tools',
        toolCalls: 4,
        errors: 0,
        errorNames: [],
        corrections: [],
        otherSkills: [],
        turnEnded: true,
        truncated: false,
        closeReason: 'user-turn',
      })
    }
    // ledger: 6 accepted edits, all on the same dimension
    for (let i = 0; i < 6; i += 1) {
      await store.append({
        t: 'edit',
        v: 1,
        at: Date.now(),
        skill: 'pdf-tools',
        hypothesis: `h${i}`,
        verdict: 'accept',
        dimension: 'static',
        reasons: [],
      })
    }
    await store.queue
    const analyzer = createAnalyzer(fakeCtx(), {
      dataDir: dir,
      minSamples: 1,
      editBudgetMax: 4,
      editBudgetMin: 1,
      editBudgetHorizon: 6,
    })
    const report = await analyzer.build()
    const entry = report.skills[0]
    assert.equal(entry.adviceBudget, 1)
    assert.equal(entry.topAdvice.length <= 1, true)
    assert.ok(entry.exploration)
    assert.equal(entry.exploration.stuck, 'static')
    assert.notEqual(entry.exploration.suggestion, 'static')
    assert.equal(report.edits.length, 6)
    assert.equal(report.edits[0].dimension, 'static')

    const fresh = await createAnalyzer(fakeCtx(), {
      dataDir: dir,
      minSamples: 1,
      editBudgetMax: 4,
      editBudgetMin: 1,
    }).build()
    assert.equal(fresh.skills[0].adviceBudget, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('per-MCP-tool latency reaches the report and the markdown board', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-mcp-'))
  try {
    const store = new EventStore(dir)
    await store.append(record({ callId: 'a', windowId: 's:a' }))
    await store.append({
      t: 'window',
      at: Date.now(),
      windowId: 's:a',
      sessionId: 's',
      skill: 'pdf-tools',
      toolCalls: 3,
      errors: 0,
      errorNames: [],
      corrections: [],
      otherSkills: [],
      turnEnded: true,
      mcp: {
        context7: {
          calls: 3,
          errors: 0,
          ms: 9000,
          samples: [100, 9000, 200],
          tools: { 'query-docs': { calls: 3, errors: 0, ms: 9000, samples: [100, 9000, 200] } },
        },
      },
    })
    await store.queue
    const report = await createAnalyzer(fakeCtx(), { dataDir: dir, minSamples: 1, mcpToolP95Ms: 5000 }).build()
    const server = report.mcpServers[0]
    assert.equal(server.server, 'context7')
    const tool = server.tools[0]
    assert.equal(tool.tool, 'query-docs')
    assert.equal(tool.p50Ms, 200)
    assert.equal(tool.p95Ms, 9000)
    assert.equal(tool.avgMs, 3000)
    assert.ok(report.mcpAdvice.some((item) => item.id === 'mcp-tool-slow'))
    assert.equal(report.mcp.toolP95Ms, 5000)
    const markdown = renderMcpMarkdown(report)
    assert.match(markdown, /Slowest tools \(p95\)/)
    assert.match(markdown, /query-docs.*p95 9000ms/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the markdown MCP view honors the configured tool p95 threshold', () => {
  const row = {
    server: 'srv',
    health: 80,
    grade: 'B',
    calls: 10,
    errors: 0,
    errorRate: 0,
    avgMs: 1000,
    p50Ms: 900,
    p95Ms: 1200,
    samples: 10,
    tools: [{ tool: 'slowtool', calls: 5, errors: 0, errorRate: 0, avgMs: 1500, p50Ms: 1200, p95Ms: 2000 }],
  }
  const tight = renderMcpMarkdown({
    mcpServers: [row],
    mcpAdvice: [],
    mcp: { p95Ms: 3000, errorRatePercent: 20, toolP95Ms: 1000, toolErrorRatePercent: 30 },
  })
  assert.match(tight, /slowtool/)
  const loose = renderMcpMarkdown({
    mcpServers: [row],
    mcpAdvice: [],
    mcp: { p95Ms: 3000, errorRatePercent: 20, toolP95Ms: 5000, toolErrorRatePercent: 30 },
  })
  assert.doesNotMatch(loose, /slowtool/)
  const legacy = renderMcpMarkdown({ mcpServers: [row], mcpAdvice: [] })
  assert.doesNotMatch(legacy, /slowtool/, 'older payloads fall back to the 5000ms default')
})

test('report steps include every step shown in the recent stepTurns window', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-steps-window-'))
  try {
    const store = new EventStore(dir)
    const started = Date.now()
    await store.append({
      t: 'step',
      at: started,
      sessionId: 's',
      turn: 1,
      step: 1,
      toolCalls: 1,
      errors: 0,
      skills: ['orca-computer-use'],
    })
    for (let step = 2; step <= 50; step += 1) {
      await store.append({
        t: 'step',
        at: started + step,
        sessionId: 's',
        turn: 1,
        step,
        toolCalls: 1,
        errors: 0,
        skills: [],
      })
    }
    for (let turn = 2; turn <= 12; turn += 1) {
      for (let step = 1; step <= 40; step += 1) {
        await store.append({
          t: 'step',
          at: started + turn * 100 + step,
          sessionId: 's',
          turn,
          step,
          toolCalls: 1,
          errors: 0,
          skills: [],
        })
      }
    }
    await store.queue
    const report = await createAnalyzer(fakeCtx(), { dataDir: dir }).build()
    const keyOf = (step: { sessionId?: string; turn?: number | null; step?: number | null; at?: number | null }) =>
      `${step.sessionId}#${step.turn}#${step.step}#${step.at}`
    const inTurns = new Set(report.stepTurns.flatMap((turn) => (turn.steps || []).map(keyOf)))
    const inSteps = new Set((report.steps || []).map(keyOf))
    for (const key of inTurns) {
      assert.ok(inSteps.has(key), `stepTurns entry ${key} missing from report.steps`)
    }
    const skillSteps = (report.steps || []).filter((step) => (step.skills || []).includes('orca-computer-use'))
    assert.equal(skillSteps.length, 1, 'the skill-bearing step in the 12-turn window must survive the steps payload')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
