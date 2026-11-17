#!/usr/bin/env node
/**
 * One-command live verification after a restart.
 *
 * The acceptance script answers "is this generation live"; this script answers
 * "can the user actually see and change the product": versioned JSON, settings
 * API, board sections, per-turn boards, and the two native entry points that
 * only the client half can provide (those are reported as manual checks because
 * a CLI cannot inspect the browser's slot tree).
 */
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { dashboardBase, expectedVersion, httpGet, resolveBaseUrl } from './lib.mjs'

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const version = expectedVersion(manifest.version)

const resolved = await resolveBaseUrl(process.argv[2])
if (!resolved.baseUrl) {
  console.log('dsh-skill-eval verify: no base URL; pass http://127.0.0.1:<port> or export DSH_WEB_URL')
  process.exit(1)
}
const base = resolved.baseUrl
const dashboard = dashboardBase()
// Hot reload keeps the canonical page route in older hands; the versioned
// alias always belongs to the generation that just started.
const boardPath = `${dashboard}/board/${version}`
const configPath = `${boardPath}/config`
const rows = []
const add = (id, ok, detail, options = {}) => rows.push({ id, ok, detail, manual: options.manual === true })

const get = (pathname, expectType) => httpGet(base, pathname, { expectType })

// 1. the generation alias and the JSON contract
let report = null
try {
  const { body } = await get(`${dashboard}/data/${version}`, 'application/json')
  report = JSON.parse(body)
  const keys = ['scoring', 'skills', 'totals', 'turnLoads', 'edits', 'validity', 'mcpServers', 'runs']
  const missing = keys.filter((key) => !(key in report))
  add(
    'versioned-json',
    missing.length === 0,
    missing.length === 0 ? `data/${version} → JSON with ${keys.length} keys` : `missing ${missing.join(', ')}`,
  )
} catch (error) {
  add('versioned-json', false, error instanceof Error ? error.message : String(error))
}

// 2. settings API: fields + effective values
try {
  const { body } = await get(`${dashboard}/settings/${version}`, 'application/json')
  const payload = JSON.parse(body)
  const fields = Array.isArray(payload.fields) ? payload.fields.length : 0
  const hasWeights = payload.values && typeof payload.values['weights.static'] !== 'undefined'
  add(
    'settings-api',
    fields > 0 && Boolean(hasWeights),
    `${fields} field(s), weights.static=${payload.values?.['weights.static']}`,
  )
} catch (error) {
  add('settings-api', false, error instanceof Error ? error.message : String(error))
}

// 3. the board HTML carries the reporting sections
try {
  let body
  try {
    body = (await get(boardPath, 'text/html')).body
  } catch {
    body = (await get(dashboard, 'text/html')).body
  }
  const sections = ['Next steps', 'What the evidence supports', 'Screened edits', 'config'].filter((needle) =>
    body.includes(needle),
  )
  add('board-sections', sections.length >= 3, `found ${sections.length}/4: ${sections.join(', ')}`)
} catch (error) {
  add('board-sections', false, error instanceof Error ? error.message : String(error))
}

// 4. the settings page renders the fields
try {
  let body
  try {
    body = (await get(configPath, 'text/html')).body
  } catch {
    body = (await get(`${dashboard}/config`, 'text/html')).body
  }
  const fields = ['weights.static', 'thresholds.excellent', 'tokenBudgetPerLoad', 'adviceNoiseFloor'].filter((key) =>
    body.includes(`name="${key}"`),
  )
  add('config-page', fields.length === 4, `found ${fields.length}/4 field(s)`)
} catch (error) {
  add('config-page', false, error instanceof Error ? error.message : String(error))
}

// 5. per-turn boards on disk (only meaningful when the generation is live)
try {
  const dir = report?.dataDir
  if (!dir) throw new Error('report has no dataDir (versioned route is not live yet)')
  const reportsDir = path.join(dir, 'reports')
  let turns = []
  try {
    turns = (await readdir(path.join(reportsDir, 'turns'))).filter((name) => name.endsWith('.json'))
  } catch {
    turns = []
  }
  add(
    'turn-boards',
    turns.length > 0,
    turns.length > 0
      ? `${turns.length} board(s), newest ${turns.sort().at(-1)}`
      : 'none yet — load a skill, finish the turn, then re-run',
  )
} catch (error) {
  add('turn-boards', false, error instanceof Error ? error.message : String(error))
}

// 6. the report contract itself: both aliases agree and the numbers are sane
try {
  const canonical = JSON.parse((await get(`${dashboard}/data`, 'application/json')).body)
  const versioned = JSON.parse((await get(`${dashboard}/data/${version}`, 'application/json')).body)
  const sameLoads = canonical.totals?.invocations === versioned.totals?.invocations
  const percent = Object.values(versioned.scoring?.weightsPercent ?? {})
  const sum = percent.reduce((a, b) => a + b, 0)
  const withCi = (versioned.skills ?? []).filter((skill) => skill.score?.ci).length
  const scored = (versioned.skills ?? []).length
  const ok = sameLoads && percent.length === 4 && sum === 100
  add(
    'report-contract',
    ok,
    `canonical=versioned:${sameLoads}, weights sum ${sum}, ${withCi}/${scored} skill(s) with a 95% interval`,
  )
} catch (error) {
  add('report-contract', false, error instanceof Error ? error.message : String(error))
}

// 7. snapshots on disk for the data dir the host reports
try {
  const snapshot = JSON.parse(
    await readFile(path.join(report?.dataDir ?? '/nonexistent', 'reports', 'latest.json'), 'utf8'),
  )
  add(
    'latest-snapshot',
    true,
    `${report?.dataDir}/reports/latest.json: ${(snapshot.skills ?? []).length} skill(s), ${(snapshot.runs ?? []).length} run(s)`,
  )
} catch (error) {
  add('latest-snapshot', false, error instanceof Error ? error.message : String(error))
}

// manual checks the CLI cannot perform
add(
  'manual:native-seats',
  true,
  'open the sidebar Skill eval panel icon (board) and Settings → Plugins → dsh-skill-eval (bundle config)',
  { manual: true },
)
add('manual:turn-strip', true, 'load a skill in a turn; its result strip shows score, next fix and edit history', {
  manual: true,
})

const failed = rows.filter((row) => !row.ok && !row.manual)
console.log(`dsh-skill-eval verify — ${base} (version ${version})`)
for (const row of rows) {
  const state = row.manual ? 'INFO' : row.ok ? 'PASS' : 'FAIL'
  console.log(`  [${state}] ${row.id.padEnd(18)} ${row.detail}`)
}
console.log('')
if (failed.length > 0) {
  console.log(`FAIL (${failed.length}) — restart DeepSeek Harness if versioned-json reports text/html.`)
  process.exit(1)
}
const checks = rows.filter((row) => !row.manual).length
const manual = rows.filter((row) => row.manual).length
console.log(
  `PASS — the running host serves this generation and the product surfaces are reachable (${checks} check(s), ${manual} manual).`,
)
