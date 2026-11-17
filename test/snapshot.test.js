import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createSnapshots, listTurnReports, renderTurnReportsMarkdown, turnSlug } from '../lib/snapshot.js'

const REPORT = {
  generatedAt: '2026-11-14T11:00:00.000Z',
  dataDir: '/tmp/data',
  totals: { invocations: 2, skills: 1, closed: 1, open: 1, storeError: null },
  skills: [
    {
      skill: 'pdf-tools',
      source: 'user-agents',
      stats: {
        loads: 2,
        closed: 1,
        open: 1,
        loadOkRate: 1,
        errRate: 0,
        correctionRate: 0.5,
        abandonRate: 0,
        siblingRate: 0,
        avgCalls: 3,
        p50LoadMs: 800,
      },
      staticQuality: { score: 77 },
      score: {
        total: 88,
        grade: 'B',
        provisional: true,
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
      topAdvice: [
        {
          id: 'user-corrections',
          severity: 'critical',
          dimension: 'effectiveness',
          title: 'The user rejects the result right after the skill runs',
          evidence: '50% of runs were followed by a correcting message',
          fix: 'Tighten the output contract.',
        },
      ],
    },
  ],
}

function fakeAnalyzer(report = REPORT) {
  const calls = { count: 0 }
  return {
    calls,
    async build() {
      calls.count += 1
      return report
    },
  }
}

async function tempDir() {
  return mkdtemp(path.join(tmpdir(), 'skill-eval-snap-'))
}

test('a settle writes markdown and json snapshots without touching the model', async () => {
  const dir = await tempDir()
  try {
    const analyzer = fakeAnalyzer()
    const snapshots = createSnapshots({ analyzer, dir, debounceMs: 1 })
    await snapshots.writeNow()

    const markdown = await readFile(path.join(dir, 'latest.md'), 'utf8')
    const json = JSON.parse(await readFile(path.join(dir, 'latest.json'), 'utf8'))
    assert.match(markdown, /Skill execution report/)
    assert.match(markdown, /pdf-tools/)
    assert.match(markdown, /88\.0/)
    assert.equal(json.skills[0].skill, 'pdf-tools')
    assert.equal(analyzer.calls.count, 1)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('several windows settling in one turn collapse into one write', async () => {
  const dir = await tempDir()
  try {
    const analyzer = fakeAnalyzer()
    const snapshots = createSnapshots({ analyzer, dir, debounceMs: 20 })
    snapshots.request()
    snapshots.request()
    snapshots.request()
    await snapshots.dispose()
    assert.equal(analyzer.calls.count, 1)
    const info = await stat(path.join(dir, 'latest.md'))
    assert.ok(info.size > 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a failing analyzer is logged, not thrown', async () => {
  const dir = await tempDir()
  try {
    const logged = []
    const snapshots = createSnapshots({
      analyzer: {
        async build() {
          throw new Error('disk on fire')
        },
      },
      dir,
      debounceMs: 1,
      log: (message) => logged.push(message),
    })
    await snapshots.writeNow()
    assert.ok(logged.some((line) => /disk on fire/.test(line)))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('dispose flushes a pending write', async () => {
  const dir = await tempDir()
  try {
    const analyzer = fakeAnalyzer()
    const snapshots = createSnapshots({ analyzer, dir, debounceMs: 60_000 })
    snapshots.request()
    await snapshots.dispose()
    assert.equal(analyzer.calls.count, 1)
    const markdown = await readFile(path.join(dir, 'latest.md'), 'utf8')
    assert.match(markdown, /pdf-tools/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

const TURN_REPORT = {
  ...REPORT,
  turnLoads: [{ sessionId: 'session-abcdef123456', turn: 7, skills: ['pdf-tools'], firstAt: 1, lastAt: 2 }],
}

test('one board is written per settled turn and the turn list reads it back', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-turns-'))
  try {
    const snapshots = createSnapshots({
      analyzer: fakeAnalyzer(TURN_REPORT),
      dir,
      debounceMs: 1,
      turnReports: true,
      turnReportsKeep: 5,
    })
    await snapshots.writeNow()
    assert.equal(turnSlug({ sessionId: 'session-abcdef123456', turn: 7 }), 'session-abcdef123456-t7')
    const markdown = await readFile(path.join(dir, 'turns', 'session-abcdef123456-t7.md'), 'utf8')
    assert.match(markdown, /skill/i)
    const rows = await listTurnReports(dir)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].turn, 7)
    assert.equal(rows[0].sessionId, 'session-abcdef123456')
    assert.deepEqual(rows[0].skills, ['pdf-tools'])
    const rendered = renderTurnReportsMarkdown(rows)
    assert.match(rendered, /## Per-turn boards/)
    assert.match(rendered, /session-abcdef123456-t7/)
    assert.match(renderTurnReportsMarkdown([]), /No per-turn board/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('per-turn boards are trimmed to the configured count', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-turns-'))
  try {
    let turn = 0
    const snapshots = createSnapshots({
      analyzer: {
        async build() {
          turn += 1
          return { ...TURN_REPORT, turnLoads: [{ sessionId: 's', turn, firstAt: 1, lastAt: 2 }] }
        },
      },
      dir,
      debounceMs: 1,
      turnReports: true,
      turnReportsKeep: 2,
    })
    for (let index = 0; index < 4; index += 1) await snapshots.writeNow()
    const rows = await listTurnReports(dir)
    assert.equal(rows.length, 2)
    assert.deepEqual(rows.map((row) => row.turn).sort(), [3, 4])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('turn reports can be disabled without touching the latest snapshot', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-turns-'))
  try {
    const snapshots = createSnapshots({ analyzer: fakeAnalyzer(TURN_REPORT), dir, debounceMs: 1, turnReports: false })
    await snapshots.writeNow()
    assert.equal((await listTurnReports(dir)).length, 0)
    const latest = await readFile(path.join(dir, 'latest.json'), 'utf8')
    assert.match(latest, /pdf-tools/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
