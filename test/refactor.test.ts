import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EDIT_DIMENSIONS as DIMENSIONS } from '../src/lib/dimensions.ts'
import { EDIT_DIMENSIONS as DIMENSIONS_REEXPORT } from '../src/lib/report.ts'
import { bootstrapCI } from '../src/lib/stats.ts'
import { mcpServers, runsOf, scoreRun, turnLoads } from '../src/lib/runs.ts'
import { manifestUrl, packageVersion, PLUGIN_VERSION } from '../src/lib/version.ts'
import {
  buildSettingsPayload,
  createOriginGate,
  effectiveWeightError,
  normalizeBasePath,
  requestLang,
} from '../src/lib/http.ts'
import { parseSkillEvalInput } from '../src/lib/command.ts'
import { VIEWS, acceptanceFiles, renderAcceptance } from '../src/lib/tools.ts'
import { normalizeSettings, SETTINGS_FIELDS, SETTINGS_GROUPS } from '../src/lib/settings.ts'
import { aggregate } from '../src/lib/score.ts'
import { EventStore } from '../src/lib/store.ts'
import { createRecorder } from '../src/lib/recorder.ts'
import type { Fn } from './helpers.ts'

test('dimensions leaf module matches the report re-export', () => {
  assert.deepEqual([...DIMENSIONS].sort(), ['effectiveness', 'efficiency', 'lifecycle', 'mcp', 'reliability', 'static'])
  assert.deepEqual(DIMENSIONS_REEXPORT, DIMENSIONS)
})

test('stats.bootstrapCI brackets the mean and is deterministic', () => {
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
    bootstrapCI([1], (draw) => draw[0]),
    null,
  )
  assert.equal(
    bootstrapCI([1, 2], () => 1, { resamples: 0 }),
    null,
  )
})

test('runs module scores runs, groups turns and merges MCP servers', () => {
  const run = {
    sessionId: 's',
    firstAt: 1,
    lastAt: 2,
    loads: 2,
    closed: 2,
    toolCalls: 4,
    errors: 0,
    corrections: 0,
    mcpCalls: 0,
    mcpErrors: 0,
    tokens: 0,
    loopErrors: 0,
    skills: ['a'],
    score: null,
  }
  const scored = scoreRun(run, new Map([['a', 80]]), { excellent: 90, good: 80, pass: 70 }, 1)
  assert.equal(typeof scored.total, 'number')
  assert.equal(scored.provisional, false)
  const turns = turnLoads([
    { t: 'skill', at: 1, sessionId: 's', skill: 'a', turn: 1 },
    { t: 'skill', at: 2, sessionId: 's', skill: 'b', turn: 1 },
  ])
  assert.equal(turns.length, 1)
  assert.deepEqual(turns[0].skills.sort(), ['a', 'b'])
  const servers = mcpServers([
    { stats: { mcp: { ctx: { calls: 4, errors: 1, ms: 400, windows: 1, samples: [100], tools: {} } } } },
  ])
  assert.equal(servers.length, 1)
  assert.equal(servers[0].server, 'ctx')
  const runs = runsOf(
    [
      { t: 'skill', at: 1, sessionId: 's', skill: 'a', callId: 'c1' },
      { t: 'window', at: 2, sessionId: 's', windowId: 'w1', toolCalls: 2, errors: 0 },
    ],
    new Map([['a', 80]]),
    { excellent: 90, good: 80, pass: 70 },
    1,
    0,
  )
  assert.equal(runs.length, 1)
  assert.equal(runs[0].loads, 1)
})

test('version module resolves the manifest from src, lib and root layouts', async () => {
  const { readFile } = await import('node:fs/promises')
  const url = manifestUrl()
  assert.match(url.pathname, /package\.json$/)
  const expected = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version
  assert.equal(packageVersion(), expected)
  assert.equal(typeof PLUGIN_VERSION, 'string')
})

test('http helpers validate base paths, gates, weights and payloads', () => {
  const warned: string[] = []
  assert.equal(
    normalizeBasePath('/skill-metrics', '/skill-eval', (m) => warned.push(m)),
    '/skill-metrics',
  )
  assert.equal(
    normalizeBasePath('metrics', '/skill-eval', (m) => warned.push(m)),
    '/skill-eval',
  )
  assert.equal(warned.length, 1)
  const gate = createOriginGate()
  assert.equal(gate.trustedRead({ headers: {} }), true)
  assert.equal(gate.trustedRead({ headers: { 'sec-fetch-site': 'cross-site' } }), false)
  assert.equal(gate.trustedWrite({ headers: { host: 'evil.com' } }), false)
  assert.equal(
    effectiveWeightError({ 'weights.static': 50 }, { static: 30, reliability: 25, effectiveness: 30, efficiency: 15 }),
    null,
  )
  assert.ok(effectiveWeightError({ 'weights.static': 0, 'weights.reliability': 0 }, { static: 0, reliability: 0 }))
  const payload = buildSettingsPayload(
    [{ key: 'minSamples', label: 'min' }],
    { minSamples: '最小' },
    { minSamples: 4 },
    PLUGIN_VERSION,
  )
  assert.equal(payload.fields[0].labelZh, '最小')
  assert.equal(payload.values.minSamples, 4)
  assert.equal(payload.version, PLUGIN_VERSION)
  assert.equal(requestLang({ url: '/x?lang=zh' }), 'zh')
  assert.equal(requestLang({}), null)
})

test('command parser splits keywords without touching the host', () => {
  assert.deepEqual(parseSkillEvalInput('history pdf-tools'), {
    keyword: 'history',
    rest: 'pdf-tools',
    target: 'history pdf-tools',
  })
  assert.deepEqual(parseSkillEvalInput('loop all'), { keyword: 'loop', rest: 'all', target: 'loop all' })
  assert.deepEqual(parseSkillEvalInput('  DEV  '), { keyword: 'dev', rest: '', target: 'DEV' })
  assert.deepEqual(parseSkillEvalInput(''), { keyword: '', rest: '', target: '' })
})

test('tools module keeps the view table and acceptance helpers', () => {
  assert.ok(VIEWS.includes('loop') && VIEWS.includes('turns'))
  const acceptance = renderAcceptance({
    results: [{ id: 'x', ok: true, detail: 'fine' }],
    summary: 'ok',
  } as never)
  assert.match(acceptance, /PASS/)
  return acceptanceFiles({ dir: '/nonexistent-sev' }, async () => {
    throw new Error('no fs')
  }).then((files) => {
    assert.deepEqual(files.events, [])
    assert.equal(files.snapshotText, null)
  })
})

test('settings snapshots trio aliases map onto the flat keys', () => {
  const { values, errors } = normalizeSettings({
    'snapshots.latest': false,
    'snapshots.turns': 'on',
    'snapshots.keep': '25',
  })
  assert.deepEqual(errors, [])
  assert.equal(values.reportOnTurnEnd, false)
  assert.equal(values.turnReports, true)
  assert.equal(values.turnReportsKeep, 25)
  const nested = normalizeSettings({ snapshots: { latest: false, turns: true, keep: 9 } })
  assert.deepEqual(nested.errors, [])
  assert.equal(nested.values.reportOnTurnEnd, false)
  assert.equal(nested.values.turnReports, true)
  assert.equal(nested.values.turnReportsKeep, 9)
  const dottedWins = normalizeSettings({
    snapshots: { latest: true, turns: false, keep: 3 },
    'snapshots.latest': false,
    'snapshots.keep': 12,
  })
  assert.equal(dottedWins.values.reportOnTurnEnd, false)
  assert.equal(dottedWins.values.turnReports, false)
  assert.equal(dottedWins.values.turnReportsKeep, 12)
  const bad = normalizeSettings({ 'snapshots.keep': '0' })
  assert.equal(bad.errors.length, 1)
  const fields = new Map(SETTINGS_FIELDS.map((f) => [f.key, f]))
  for (const key of [
    'windowToolCalls',
    'mcpToolErrorRatePercent',
    'mcpToolP95Ms',
    'turnReports',
    'turnReportsKeep',
    'redactCorrections',
  ]) {
    assert.ok(fields.has(key), key)
  }
  const grouped = SETTINGS_GROUPS.flatMap((g) => g.keys)
  assert.equal(new Set(grouped).size, grouped.length)
  for (const field of SETTINGS_FIELDS) assert.ok(grouped.includes(field.key), field.key)
})

test('parallel windows split token amounts 1/N while steps keep the full total', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-split-'))
  try {
    const store = new EventStore(dir)
    const handlers = new Map<string, Fn[]>()
    const ctx = {
      on: (n: string, fn: Fn) => {
        const l = handlers.get(n) ?? []
        l.push(fn)
        handlers.set(n, l)
        return () => {}
      },
    }
    const agent = { id: 's-split' }
    const recorder = createRecorder(ctx, { windowToolCalls: 12 }, { store })
    const emit = (n: string, ...a: unknown[]) => {
      for (const fn of handlers.get(n) ?? []) fn(...a)
    }
    // one loop step, two parallel skill loads
    emit('agent/pre-step', { agent, step: 1, turn: 1, messages: [] }, () => {})
    const a = { callId: 'ca', name: 'skill', arguments: { name: 'alpha' }, agent }
    const b = { callId: 'cb', name: 'skill', arguments: { name: 'beta' }, agent }
    emit('tools/pre-execute', a, () => {})
    emit('tools/result', a, { isError: false, value: {}, content: [] })
    emit('tools/pre-execute', b, () => {})
    emit('tools/result', b, { isError: false, value: {}, content: [] })
    emit(
      'session/event',
      { id: 's-split' },
      { type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0 } } },
    )
    emit('agent/turn-stopping', { agent, turn: 1 })
    await recorder.flush()
    const records = await store.readAll()
    const windows = records.filter((r) => r.t === 'window')
    assert.equal(windows.length, 2)
    for (const w of windows) {
      assert.equal(Number(w.tokens?.input), 50)
      assert.equal(Number(w.tokens?.output), 25)
    }
    const stats = aggregate(windows.map((w) => ({ ok: true, window: { toolCalls: 0, errors: 0, tokens: w.tokens } })))
    assert.equal(stats.tokens.input, 100)
    await recorder.dispose()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('concurrent overflows coalesce onto one bounded rotation', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-rotate-'))
  try {
    const store = new EventStore(dir, { maxBytes: 2000 })
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        store.append({
          t: 'window',
          at: i,
          windowId: `w${i}`,
          sessionId: 's',
          skill: 'a',
          toolCalls: 1,
          filler: 'x'.repeat(200),
        }),
      ),
    )
    await store.queue
    const size = await store.size()
    assert.ok(size <= 2000 + 500, `size ${size} bounded near the cap`)
    const records = await store.readAll()
    assert.ok(records.length > 0 && records.length < 30)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
