import test from 'node:test'
import assert from 'node:assert/strict'
import { createInspectProvider } from '../src/lib/inspect.ts'
import type { Report, SkillEntry } from '../src/lib/report.ts'
import { partial } from './helpers.ts'
import type { Fake } from './helpers.ts'

const ENTRY = partial<SkillEntry>({
  skill: 'pdf-tools',
  source: 'user-agents',
  stats: {
    loads: 3,
    closed: 2,
    open: 1,
    loadOkRate: 1,
    errRate: 0,
    correctionRate: 0.5,
    abandonRate: 0,
    siblingRate: 0,
    avgCalls: 3,
    p50LoadMs: 800,
  },
  score: {
    total: 88,
    grade: 'B',
    provisional: false,
    confidence: 'medium',
    samples: 3,
    dimensions: { static: 77, reliability: 100, effectiveness: 80, efficiency: 95 },
  },
  advice: [
    {
      id: 'user-corrections',
      severity: 'critical',
      dimension: 'effectiveness',
      title: 'The user rejects the result right after the skill runs',
      evidence: '50% of runs were followed by a correcting message',
      fix: 'Tighten the output contract.',
    },
  ],
})

const REPORT = partial<Report>({
  generatedAt: '2026-11-14T11:30:00.000Z',
  dataDir: '/tmp/data',
  totals: { invocations: 3, skills: 1, closed: 2, open: 1, storeError: null },
  scoring: {
    weights: { static: 0.3, reliability: 0.25, effectiveness: 0.3, efficiency: 0.15 },
    weightsPercent: { static: 30, reliability: 25, effectiveness: 30, efficiency: 15 },
    thresholds: { excellent: 90, good: 80, pass: 70 },
    minSamples: 3,
    customizable: true,
  },
  skills: [ENTRY],
  mcpServers: [
    { server: 'context7', calls: 2, errors: 1, errorRate: 0.5, avgMs: 200, health: 65, grade: 'D', tools: [] },
  ],
  runs: [
    {
      sessionId: 'session-1',
      loads: 3,
      toolCalls: 9,
      errors: 0,
      corrections: 1,
      mcpCalls: 2,
      mcpErrors: 1,
      skills: ['pdf-tools'],
    },
  ],
})

function analyzer() {
  return {
    async build() {
      return REPORT
    },
    async buildOne(name: string) {
      return name === 'pdf-tools' ? ENTRY : null
    },
  }
}

test('the inspect manifest is valid: unique ids and described methods', () => {
  const provider = createInspectProvider(analyzer())
  assert.equal(provider.manifest.id, 'skill-eval')
  assert.ok(provider.manifest.description.length > 10)
  const names = provider.manifest.methods.map((method) => method.name)
  assert.deepEqual(names, ['summary', 'skill', 'mcp', 'runs', 'edits', 'standard'])
  assert.equal(new Set(names).size, names.length)
  for (const method of provider.manifest.methods) {
    assert.ok(method.description.length > 5, method.name)
    assert.equal(typeof method.inputSchema, 'object')
  }
})

test('summary is bounded: numbers and advice identity, not the prose', async () => {
  const provider = createInspectProvider(analyzer())
  const data: Fake = await provider.query('summary', {})
  assert.equal(data.skills.length, 1)
  const row = data.skills[0]
  assert.equal(row.skill, 'pdf-tools')
  assert.equal(row.score, 88)
  assert.equal(row.grade, 'B')
  assert.equal(row.confidence, 'medium')
  assert.deepEqual(row.dimensions, { static: 77, reliability: 100, effectiveness: 80, efficiency: 95 })
  assert.deepEqual(row.advice, [{ id: 'user-corrections', severity: 'critical', dimension: 'effectiveness' }])
  assert.equal(JSON.stringify(data).includes('Tighten the output contract'), false)
  assert.equal(data.scoring.thresholds.excellent, 90)
})

test('skill returns the full entry and rejects unknown names', async () => {
  const provider = createInspectProvider(analyzer())
  const entry: Fake = await provider.query('skill', { skill: 'pdf-tools' })
  assert.equal(entry.skill, 'pdf-tools')
  assert.equal(entry.advice[0].fix.length > 0, true)
  await assert.rejects(() => provider.query('skill', { skill: 'ghost' }), /no evidence recorded/)
  await assert.rejects(() => provider.query('skill', {}), /required/)
})

test('mcp, runs and standard are read-only projections', async () => {
  const provider = createInspectProvider(analyzer())
  const mcp: Fake = await provider.query('mcp', {})
  assert.equal(mcp.mcpServers[0].server, 'context7')
  assert.equal(mcp.mcpServers[0].health, 65)
  const runs: Fake = await provider.query('runs', {})
  assert.equal(runs.runs[0].sessionId, 'session-1')
  const edits: Fake = await provider.query('edits', {})
  assert.deepEqual(edits.edits, [])
  const standard: Fake = await provider.query('standard', {})
  assert.equal(standard.scoring.weightsPercent.effectiveness, 30)
})

test('an unknown method is rejected with a clear error', async () => {
  const provider = createInspectProvider(analyzer())
  await assert.rejects(() => provider.query('nope', {}), /unknown method/)
})
