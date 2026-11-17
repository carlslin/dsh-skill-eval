import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDevReport, renderDevMarkdown } from '../lib/dev.js'

function base(overrides = {}) {
  return {
    moduleVersion: '1.12.2',
    diskVersion: '1.12.2',
    dataDir: '/data',
    settingsFile: '/data/settings.json',
    settings: { 'weights.static': 30 },
    config: { weights: { static: 30 }, thresholds: { excellent: 90 }, minSamples: 3 },
    routes: ['/skill-eval/data', '/skill-eval/settings'],
    records: [
      { t: 'skill', at: 1000 },
      { t: 'skill', at: 2000 },
      { t: 'window', at: 3000 },
      { t: 'edit', at: 4000 },
    ],
    store: { dir: '/data', failed: null, queued: 0 },
    tools: ['skill_eval_report', 'skill_eval_review'],
    inspectProvider: 'skill-eval',
    warnings: [],
    now: 10_000,
    ...overrides,
  }
}

test('a matching generation has no critical findings', () => {
  const dev = buildDevReport(base())
  assert.equal(dev.versions.skew, false)
  assert.deepEqual(dev.findings, [])
  assert.equal(dev.store.records, 4)
  assert.deepEqual(dev.store.types, ['skill', 'window', 'edit'])
  assert.equal(dev.store.counts.skill, 2)
  assert.equal(dev.store.lastEventAgeMs, 6000)
})

test('a module older than package.json is flagged as a restart', () => {
  const dev = buildDevReport(base({ moduleVersion: '1.10.1', diskVersion: '1.12.2' }))
  assert.equal(dev.versions.skew, true)
  const finding = dev.findings.find((item) => item.code === 'module-skew')
  assert.equal(finding.severity, 'critical')
  assert.match(finding.detail, /restart DeepSeek Harness/)
  assert.match(renderDevMarkdown(dev), /skew: \*\*YES — restart needed\*\*/)
})

test('missing telemetry, tools, routes and store failures are reported', () => {
  const dev = buildDevReport(
    base({
      records: [],
      tools: [],
      inspectProvider: null,
      routes: ['/skill-eval/data'],
      store: { dir: '/data', failed: 'ENOSPC', queued: 1 },
    }),
  )
  const codes = dev.findings.map((item) => item.code).sort()
  assert.deepEqual(codes, [
    'no-inspect-provider',
    'no-settings-route',
    'no-telemetry',
    'no-tools',
    'store-write-failed',
  ])
  const text = renderDevMarkdown(dev)
  assert.match(text, /ENOSPC/)
  assert.match(text, /no event|no telemetry/i)
})

test('a rejected saved setting becomes a finding instead of a silent drop', () => {
  const dev = buildDevReport(
    base({
      settings: { minSamples: 5 },
      settingsErrors: [{ key: 'windowTtlMs', message: 'not a number: 30m' }],
    }),
  )
  const finding = dev.findings.find((item) => item.code === 'settings-invalid')
  assert.ok(finding, 'settings-invalid finding missing')
  assert.match(finding.detail, /windowTtlMs/)
  assert.equal(dev.settingsKeys, 1)
  assert.equal(dev.settingsErrors, 1)
  assert.match(renderDevMarkdown(dev), /1 key\(s\), 1 rejected/)
})

test('the rendered diagnostics summarize versions, store and routes', () => {
  const text = renderDevMarkdown(buildDevReport(base()))
  assert.match(text, /## Developer diagnostics/)
  assert.match(text, /module: \*\*1\.12\.2\*\*/)
  assert.match(text, /store: 4 record\(s\) · types: skill×2, window×1, edit×1/)
  assert.match(text, /last event: 6s ago/)
  assert.match(text, /routes: 2 exact\/prefix path\(s\)/)
  assert.match(text, /tools: skill_eval_report, skill_eval_review/)
  assert.match(text, /nothing suspicious/)
  assert.match(renderDevMarkdown(null), /no data/)
})
