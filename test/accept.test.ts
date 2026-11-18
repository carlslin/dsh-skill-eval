import test from 'node:test'
import assert from 'node:assert/strict'
import {
  STALE_HINT,
  UNREACHABLE_HINT,
  checkConfigPage,
  checkFileState,
  checkInProcessReport,
  checkReportPayload,
  checkSettingsApi,
  checkVersionedPayload,
  pickBaseUrl,
  runAcceptance,
} from '../src/lib/accept.ts'
import { byId } from './helpers.ts'

const MODERN = {
  generatedAt: '2026-11-14T12:00:00.000Z',
  dataDir: '/tmp/data',
  totals: { invocations: 1, skills: 1, closed: 1, open: 0, storeError: null },
  scoring: {
    weights: { static: 0.3, reliability: 0.25, effectiveness: 0.3, efficiency: 0.15 },
    weightsPercent: { static: 30, reliability: 25, effectiveness: 30, efficiency: 15 },
    thresholds: { excellent: 90, good: 80, pass: 70 },
    minSamples: 3,
  },
  ranking: { significant: true, note: null, ties: [] },
  mcpServers: [],
  runs: [],
  skills: [{ skill: 'a', score: { total: 80, ci: { low: 70, high: 90, resamples: 200 } } }],
}

test('a current payload passes every shape check', () => {
  const results = checkReportPayload(MODERN)
  assert.equal(
    results.every((item) => item.ok),
    true,
    JSON.stringify(results.filter((item) => !item.ok)),
  )
})

test('a stale generation fails with the restart hint', () => {
  const results = checkReportPayload({ dataDir: '/tmp', generatedAt: '', totals: {}, skills: [] })
  const shape = byId(results, 'report-shape')
  assert.equal(shape.ok, false)
  assert.match(shape.detail, /older plugin generation/)
  assert.equal(STALE_HINT.includes('quit and reopen'), true)
})

test('a non-object response is reported instead of throwing', () => {
  const results = checkReportPayload(null)
  assert.equal(results.length, 1)
  assert.equal(results[0].ok, false)
})

test('file checks separate telemetry, snapshot and generation', () => {
  const results = checkFileState({
    eventsPath: '/tmp/events.jsonl',
    snapshotMarkdownPath: '/tmp/reports/latest.md',
    snapshotJsonPath: '/tmp/reports/latest.json',
    events: [{ t: 'skill' }, { t: 'window' }],
    snapshotText: '## Skill execution report\n',
    snapshotJsonText: JSON.stringify(MODERN),
  })
  assert.equal(
    results.every((item) => item.ok),
    true,
    JSON.stringify(results.filter((item) => !item.ok)),
  )
  const generation = byId(results, 'snapshot-generation')
  assert.match(generation.detail, /scoring/)

  const old = checkFileState({
    eventsPath: '/tmp/events.jsonl',
    snapshotMarkdownPath: '/tmp/reports/latest.md',
    snapshotJsonPath: '/tmp/reports/latest.json',
    events: [],
    snapshotText: null,
    snapshotJsonText: JSON.stringify({ skills: [] }),
  })
  const telemetry = byId(old, 'telemetry-file')
  assert.equal(telemetry.ok, true)
  assert.equal(telemetry.skipped, true)
  assert.match(telemetry.detail, /no telemetry yet/)
  const failed = old.filter((item) => !item.ok).map((item) => item.id)
  assert.deepEqual(failed.sort(), ['snapshot-generation', 'snapshot-markdown'])
  assert.ok(failed.includes('snapshot-generation'))

  const missingEvents = checkFileState({
    eventsPath: '/tmp/events.jsonl',
    snapshotMarkdownPath: '/tmp/reports/latest.md',
    snapshotJsonPath: '/tmp/reports/latest.json',
    events: null,
    snapshotText: '## Skill execution report\n',
    snapshotJsonText: JSON.stringify(MODERN),
  })
  const missingTelemetry = byId(missingEvents, 'telemetry-file')
  assert.equal(missingTelemetry.ok, true)
  assert.equal(missingTelemetry.skipped, true)
  assert.deepEqual(
    missingEvents.filter((item) => !item.ok),
    [],
  )
})

test('a profile with no store files skips telemetry and both snapshots', () => {
  const results = checkFileState({
    eventsPath: '/tmp/events.jsonl',
    snapshotMarkdownPath: '/tmp/reports/latest.md',
    snapshotJsonPath: '/tmp/reports/latest.json',
    events: null,
    snapshotText: null,
    snapshotJsonText: null,
  })
  assert.equal(
    results.every((item) => item.ok),
    true,
    JSON.stringify(results.filter((item) => !item.ok)),
  )
  assert.deepEqual(
    results.filter((item) => item.skipped).map((item) => item.id),
    ['telemetry-file', 'snapshot-markdown', 'snapshot-json'],
  )
})

test('runAcceptance composes the report and keeps the manual popup check', async () => {
  const ok = await runAcceptance({
    baseUrl: 'http://x',
    fetchReport: async () => MODERN,
    readFiles: async () => ({
      eventsPath: '/tmp/e.jsonl',
      snapshotMarkdownPath: '/tmp/a.md',
      snapshotJsonPath: '/tmp/a.json',
      events: [{ t: 'skill' }],
      snapshotText: '## Skill execution report',
      snapshotJsonText: JSON.stringify(MODERN),
    }),
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.summary, 'PASS')
  assert.ok(ok.results.some((item) => item.id === 'client-surface' && item.ok))

  const bad = await runAcceptance({
    baseUrl: 'http://x',
    fetchReport: async () => {
      throw new Error('ECONNREFUSED')
    },
  })
  assert.equal(bad.ok, false)
  assert.match(bad.summary, /UNREACHABLE/)
  assert.ok(bad.results.some((item) => item.id === 'report-fetch' && !item.ok))
})

test('an empty store skips telemetry and still passes', async () => {
  const empty = await runAcceptance({
    baseUrl: 'http://x',
    fetchReport: async () => MODERN,
    readFiles: async () => ({
      eventsPath: '/tmp/e.jsonl',
      snapshotMarkdownPath: '/tmp/a.md',
      snapshotJsonPath: '/tmp/a.json',
      events: null,
      snapshotText: '## Skill execution report',
      snapshotJsonText: JSON.stringify(MODERN),
    }),
  })
  assert.equal(empty.ok, true)
  assert.match(empty.summary, /^PASS \(1 skipped/)
  assert.equal(byId(empty.results, 'telemetry-file').skipped, true)
})

test('a files read error does not claim a stale generation', async () => {
  const report = await runAcceptance({
    baseUrl: 'http://x',
    fetchReport: async () => MODERN,
    readFiles: async () => {
      throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' })
    },
  })
  assert.equal(report.ok, false)
  assert.match(report.summary, /^FAIL/)
  assert.equal(report.summary.includes('older plugin generation'), false)
  assert.equal(report.summary.includes('reopen DeepSeek Harness'), false)
})

test('the versioned route must agree with the canonical one', async () => {
  const files = async () => ({
    eventsPath: '/tmp/e.jsonl',
    snapshotMarkdownPath: '/tmp/a.md',
    snapshotJsonPath: '/tmp/a.json',
    events: [{ t: 'skill' }],
    snapshotText: '## Skill execution report',
    snapshotJsonText: JSON.stringify(MODERN),
  })
  const same = await runAcceptance({
    baseUrl: 'http://x',
    fetchReport: async () => MODERN,
    fetchVersioned: async () => MODERN,
    readFiles: files,
  })
  assert.equal(byId(same.results, 'versioned-route').ok, true)

  const mismatch = await runAcceptance({
    baseUrl: 'http://x',
    fetchReport: async () => MODERN,
    fetchVersioned: async () => ({ ...MODERN, totals: { ...MODERN.totals, invocations: 99 } }),
    readFiles: files,
  })
  assert.equal(byId(mismatch.results, 'versioned-route').ok, false)

  const missing = await runAcceptance({
    baseUrl: 'http://x',
    fetchReport: async () => MODERN,
    fetchVersioned: async () => {
      throw new Error('404')
    },
    readFiles: files,
  })
  assert.match(byId(missing.results, 'versioned-route').detail, /predates the versioned alias/)
})

test('in-process acceptance reuses the shape checks and adds the host-only ones', () => {
  const files = {
    eventsPath: '/tmp/e.jsonl',
    snapshotMarkdownPath: '/tmp/a.md',
    snapshotJsonPath: '/tmp/a.json',
    events: [{ t: 'skill' }],
    snapshotText: '## Skill execution report',
    snapshotJsonText: JSON.stringify(MODERN),
  }
  const modern = checkInProcessReport(MODERN, { version: '0.3.0', files })
  assert.equal(modern.ok, true, JSON.stringify(modern.results.filter((item) => !item.ok)))
  assert.equal(modern.summary, 'PASS')
  assert.ok(modern.results.some((item) => item.id === 'plugin-version' && item.detail === '0.3.0'))

  const legacy = checkInProcessReport({ skills: [], totals: {}, dataDir: '/tmp' }, { version: '0.1.0' })
  assert.equal(legacy.ok, false)
  assert.match(legacy.summary, /FAIL/)
})

test('the base URL is taken from the argument, then DSH_WEB_URL, then the relay bridge', () => {
  const bridge = { upstream: 'http://127.0.0.1:60330' }
  assert.deepEqual(pickBaseUrl('http://127.0.0.1:1/', null, bridge), {
    baseUrl: 'http://127.0.0.1:1',
    source: 'argument',
  })
  assert.deepEqual(pickBaseUrl(null, 'http://127.0.0.1:2', bridge), {
    baseUrl: 'http://127.0.0.1:2',
    source: 'DSH_WEB_URL',
  })
  assert.deepEqual(pickBaseUrl(null, null, bridge), { baseUrl: 'http://127.0.0.1:60330', source: 'relay-bridge' })
  assert.deepEqual(pickBaseUrl(null, null, null), { baseUrl: null, source: 'none' })
})

test('an unreachable host is not reported as a stale generation', async () => {
  const error: Error & { unreachable?: boolean } = new Error(
    'http://127.0.0.1:53399/skill-eval/data is unreachable (ECONNREFUSED)',
  )
  error.unreachable = true
  const report = await runAcceptance({
    baseUrl: 'http://127.0.0.1:53399',
    fetchReport: async () => {
      throw error
    },
  })
  assert.equal(report.ok, false)
  assert.match(report.summary, /UNREACHABLE/)
  assert.match(report.summary, /DSH_WEB_URL/)
  assert.equal(report.summary.includes('reopen DeepSeek Harness'), false)
  assert.equal(byId(report.results, 'report-fetch').unreachable, true)
})

test('a shape mismatch still reports the stale-generation hint', async () => {
  const report = await runAcceptance({ baseUrl: 'http://x', fetchReport: async () => ({ skills: [], totals: {} }) })
  assert.match(report.summary, /FAIL/)
  assert.match(report.summary, new RegExp('reopen DeepSeek Harness'))
})

test('a missing data route still reports the stale-generation hint', async () => {
  const report = await runAcceptance({
    baseUrl: 'http://x',
    fetchReport: async () => {
      throw new Error('http://x/skill-eval/data returned text/html instead of JSON (route missing)')
    },
  })
  assert.equal(report.ok, false)
  assert.match(report.summary, /^FAIL/)
  assert.match(report.summary, /older plugin generation/)
})

test('the unreachable hint mentions how to recover', () => {
  assert.match(UNREACHABLE_HINT, /DSH_WEB_URL/)
  assert.equal(STALE_HINT.includes('reopen'), true)
})

test('the versioned payload proves the current generation through token fields', () => {
  const current = {
    ...MODERN,
    skills: [
      {
        skill: 'a',
        score: { total: 80 },
        stats: { tokensPerLoad: 1200, tokens: { input: 1000, output: 200, calls: 1 } },
      },
    ],
  }
  const old = { ...MODERN, skills: [{ skill: 'a', score: { total: 80 }, stats: {} }] }
  const good = checkVersionedPayload(current, current)
  assert.equal(byId(good, 'token-accounting').ok, true)
  assert.equal(byId(good, 'canonical-route').ok, true)
  assert.match(byId(good, 'canonical-route').detail, /agree/)

  const stale = checkVersionedPayload(old, { ...old, extra: true })
  assert.equal(byId(stale, 'token-accounting').ok, false)
  assert.equal(byId(stale, 'canonical-route').ok, false)
  assert.match(byId(stale, 'canonical-route').detail, /older handler/)
})

test('the settings page is checked for its core fields', () => {
  const good = checkConfigPage('<input name="weights.static"><input name="minSamples"><input name="adviceNoiseFloor">')
  assert.equal(good.id, 'config-page')
  assert.equal(good.ok, true)
  const bad = checkConfigPage('<html>not the settings page</html>')
  assert.equal(bad.ok, false)
  assert.match(bad.detail, /weights\.static/)
})

test('an unreachable settings page is reported as unreachable, not stale', async () => {
  const error: Error & { unreachable?: boolean } = new Error('http://x/config is unreachable (ECONNREFUSED)')
  error.unreachable = true
  const report = await runAcceptance({
    baseUrl: 'http://x',
    fetchReport: async () => {
      throw error
    },
    fetchConfigPage: async () => {
      throw error
    },
  })
  assert.match(report.summary, /UNREACHABLE/)
})

test('the settings API is checked for fields and effective values', () => {
  const good = checkSettingsApi({
    fields: [{ key: 'weights.static' }, { key: 'minSamples' }],
    values: { 'weights.static': 0.3 },
  })
  assert.equal(good.id, 'settings-api')
  assert.equal(good.ok, true)
  const bad = checkSettingsApi({})
  assert.equal(bad.ok, false)
  assert.match(bad.detail, /fields/)
})
