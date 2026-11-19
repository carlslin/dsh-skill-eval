import test from 'node:test'
import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  applySettings,
  loadSettings,
  loadSettingsSync,
  normalizeSettings,
  parseFormSettings,
  readSetting,
  renderConfigHtml,
  saveSettings,
  updateSettings,
  SETTINGS_FIELDS,
  SETTINGS_GROUPS,
  UNIT_ZH,
  unitLabel,
} from '../src/lib/settings.ts'

test('submitted values are validated against the field bounds', () => {
  const { values, errors } = normalizeSettings({
    'weights.static': '0.4',
    'weights.reliability': '0.2',
    'weights.effectiveness': '0.25',
    'weights.efficiency': '0.15',
    minSamples: '4',
    adviceNoiseFloor: 'on',
    countTokens: 'off',
    unknownKey: 'x',
  })
  assert.deepEqual(errors, [])
  assert.equal(values.minSamples, 4)
  assert.equal(values.adviceNoiseFloor, true)
  assert.equal(values.countTokens, false)
  assert.equal('unknownKey' in values, false)

  const bounds = normalizeSettings({ 'thresholds.excellent': '0', mcpErrorRatePercent: '0', mcpP95Ms: '50' })
  assert.equal(bounds.errors.length, 3)
  const bad = normalizeSettings({ minSamples: '0', ciResamples: 'many', promptHint: 'on' })
  assert.equal(bad.errors.length, 2)
  assert.deepEqual(bad.errors.map((error) => error.key).sort(), ['ciResamples', 'minSamples'])
})

test('every field ships its group metadata for the client form', () => {
  for (const field of SETTINGS_FIELDS) {
    assert.ok(field.group && field.groupZh, `${field.key} has group titles`)
  }
})

test('every setting belongs to exactly one form group', () => {
  const grouped = SETTINGS_GROUPS.flatMap((group) => group.keys)
  assert.deepEqual([...grouped].sort(), SETTINGS_FIELDS.map((field) => field.key).sort())
  assert.equal(new Set(grouped).size, grouped.length)
})

test('settings writes are serialized and atomic', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sev-settings-'))
  try {
    await Promise.all([saveSettings(dir, { minSamples: 4 }), saveSettings(dir, { maxAdvice: 5 })])
    const raw = await readFile(path.join(dir, 'settings.json'), 'utf8')
    assert.doesNotThrow(() => JSON.parse(raw))
    const values = await loadSettings(dir)
    assert.ok(
      (values.minSamples === 4 && values.maxAdvice === undefined) ||
        (values.maxAdvice === 5 && values.minSamples === undefined),
      'one complete write wins',
    )
    await assert.rejects(access(path.join(dir, 'settings.json.tmp')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('concurrent partial updates keep every field', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sev-settings-'))
  try {
    await updateSettings(dir, { minSamples: 4 })
    await Promise.all([updateSettings(dir, { maxAdvice: 5 }), updateSettings(dir, { pruneMinLoads: 9 })])
    const values = await loadSettings(dir)
    assert.equal(values.minSamples, 4)
    assert.equal(values.maxAdvice, 5)
    assert.equal(values.pruneMinLoads, 9)
    await assert.rejects(access(path.join(dir, 'settings.json.tmp')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an HTML form POST turns absent checkboxes into false, so toggles can be saved', () => {
  const submitted = parseFormSettings('__full_form=1&weights.static=30&adviceNoiseFloor=on&promptHint=on')
  assert.equal(submitted.adviceNoiseFloor, 'on')
  assert.equal(submitted.promptHint, 'on')
  // absent from the form body -> unchecked -> must be persisted as false
  assert.equal(submitted.reportOnTurnEnd, false)
  assert.equal(submitted.countTokens, false)
  const { values, errors } = normalizeSettings(submitted)
  assert.deepEqual(errors, [])
  assert.equal(values.reportOnTurnEnd, false)
  assert.equal(values.adviceNoiseFloor, true)

  // A partial POST (no __full_form marker) must not disable the other toggles.
  const partial = parseFormSettings('weights.static=40')
  assert.equal('countTokens' in partial, false)
  assert.equal('reportOnTurnEnd' in partial, false)
})

test('zero total weights are rejected instead of silently producing NaN scores', () => {
  const { errors } = normalizeSettings({
    'weights.static': '0',
    'weights.reliability': '0',
    'weights.effectiveness': '0',
    'weights.efficiency': '0',
  })
  assert.equal(
    errors.some((error) => error.key === 'weights.total'),
    true,
  )
})

test('overrides save, load (sync and async) and re-apply to a config object', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-settings-'))
  try {
    assert.deepEqual(await loadSettings(dir), {})
    assert.deepEqual(loadSettingsSync(dir), {})
    const file = await saveSettings(dir, { 'weights.static': 0.5, minSamples: 5, adviceNoiseFloor: false })
    assert.match(file, /settings\.json$/)
    assert.deepEqual(await loadSettings(dir), { 'weights.static': 0.5, minSamples: 5, adviceNoiseFloor: false })
    assert.deepEqual(loadSettingsSync(dir), { 'weights.static': 0.5, minSamples: 5, adviceNoiseFloor: false })

    const cfg = {
      weights: { static: 0.3, reliability: 0.25, effectiveness: 0.3, efficiency: 0.15 },
      minSamples: 3,
      adviceNoiseFloor: true,
    }
    applySettings(cfg, loadSettingsSync(dir))
    assert.equal(cfg.weights.static, 0.5)
    assert.equal(cfg.weights.reliability, 0.25)
    assert.equal(cfg.minSamples, 5)
    assert.equal(cfg.adviceNoiseFloor, false)
    assert.equal(readSetting(cfg, 'weights.static'), 0.5)
    assert.equal(readSetting(cfg, 'weights.missing'), undefined)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a settings save canonicalises snapshot aliases so reload cannot undo it', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sev-settings-alias-'))
  try {
    const file = path.join(dir, 'settings.json')
    await writeFile(file, JSON.stringify({ snapshots: { latest: false, turns: false, keep: 5 } }))
    await updateSettings(dir, { reportOnTurnEnd: true, turnReports: true, turnReportsKeep: 9 })
    const raw = await loadSettings(dir)
    assert.equal(raw.reportOnTurnEnd, true)
    assert.equal(raw.turnReports, true)
    assert.equal(raw.turnReportsKeep, 9)
    assert.equal('snapshots' in raw, false, 'nested alias object is collapsed')
    const cfg: Record<string, unknown> = {}
    applySettings(cfg, normalizeSettings(raw).values)
    assert.equal(cfg.reportOnTurnEnd, true)
    assert.equal(cfg.turnReports, true)
    assert.equal(cfg.turnReportsKeep, 9)

    // A partial save still preserves the sibling values the aliases carried.
    await writeFile(file, JSON.stringify({ 'snapshots.latest': false, 'snapshots.turns': false, 'snapshots.keep': 5 }))
    await updateSettings(dir, { reportOnTurnEnd: true })
    const partial = await loadSettings(dir)
    assert.equal(partial.reportOnTurnEnd, true)
    assert.equal(partial.turnReports, false)
    assert.equal(partial.turnReportsKeep, 5)
    assert.equal('snapshots.latest' in partial, false, 'dotted aliases are collapsed')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the configuration page lists every field and reports save state', () => {
  const cfg = {
    weights: { static: 0.3, reliability: 0.25, effectiveness: 0.3, efficiency: 0.15 },
    minSamples: 3,
    adviceNoiseFloor: true,
    tokenBudgetPerLoad: 20000,
  }
  const html = renderConfigHtml({ config: cfg, base: '/skill-eval', lang: 'zh' })
  assert.match(html, /技能评测 · 配置/)
  assert.match(html, /返回看板/)
  for (const field of SETTINGS_FIELDS) assert.ok(html.includes(`name="${field.key}"`), field.key)
  assert.match(html, /name="weights\.static" value="0\.3"/)
  assert.match(html, /name="adviceNoiseFloor" checked/)
  assert.equal(html.includes('已保存并应用'), false)

  const saved = renderConfigHtml({ config: cfg, base: '/skill-eval', lang: 'zh', saved: true })
  assert.match(saved, /已保存并应用/)
  const broken = renderConfigHtml({
    config: cfg,
    base: '/skill-eval',
    lang: 'zh',
    errors: [{ key: 'minSamples', message: 'out of range 1..100' }],
  })
  assert.match(broken, /有 1 个字段未保存/)
  assert.match(broken, /minSamples/)
})

test('saving settings creates the data directory owner-only', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sev-settings-mode-'))
  try {
    const dir = path.join(root, 'nested', 'profile')
    await saveSettings(dir, { minSamples: 5 })
    assert.equal((await stat(dir)).mode & 0o777, 0o700)
    assert.equal((await stat(path.join(dir, 'settings.json'))).mode & 0o777, 0o600)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a leftover settings temp file does not leak its old mode', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sev-settings-tmp-'))
  try {
    await writeFile(path.join(dir, 'settings.json.tmp'), 'stale', { mode: 0o644 })
    await saveSettings(dir, { minSamples: 5 })
    assert.equal((await stat(path.join(dir, 'settings.json'))).mode & 0o777, 0o600)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a cleared numeric field is an error, not a silent zero', () => {
  for (const raw of ['', null]) {
    const { values, errors } = normalizeSettings({ 'weights.static': raw })
    assert.equal('weights.static' in values, false, JSON.stringify(raw))
    assert.ok(
      errors.some((error) => error.key === 'weights.static'),
      JSON.stringify(raw),
    )
  }
  const { values, errors } = normalizeSettings({ 'weights.static': '0' })
  assert.deepEqual(errors, [])
  assert.equal(values['weights.static'], 0)
})

test('Chinese unit labels cover every English unit used by the form, including boards and calls', () => {
  const units = [...new Set(SETTINGS_FIELDS.map((field) => field.unit).filter((unit): unit is string => Boolean(unit)))]
  assert.ok(units.includes('boards'))
  assert.ok(units.includes('calls'))
  // Word units are localized; symbols such as % and ms stay as-is.
  for (const unit of ['loads', 'edits', 'calls', 'boards']) {
    assert.ok(unit in UNIT_ZH, unit)
    assert.notEqual(unitLabel(unit, true), unit, `${unit} must have a Chinese label`)
    assert.equal(unitLabel(unit, true), UNIT_ZH[unit])
  }
  assert.equal(unitLabel('boards', true), '块看板')
  assert.equal(unitLabel('calls', true), '次调用')
  assert.equal(unitLabel('boards', false), 'boards')
})

test('the Chinese settings page localizes boards and calls units', () => {
  const html = renderConfigHtml({ config: {}, base: '/skill-eval', lang: 'zh' })
  assert.match(html, /块看板/)
  assert.match(html, /次调用/)
  assert.doesNotMatch(html, />boards</)
  assert.doesNotMatch(html, />calls</)
})
