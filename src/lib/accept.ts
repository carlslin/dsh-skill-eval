/**
 * Post-restart acceptance checks.
 *
 * A profile plugin only loads at host boot, so after installing or upgrading
 * `dsh-skill-eval` the running page can keep serving a previous generation.
 * This module answers "did the current generation actually load?" from outside
 * the process: the JSON route, the snapshot files and the recorded telemetry.
 */

import type { Json } from './types.ts'

export interface CheckResult {
  id: string
  ok: boolean
  detail: string
  /** Nothing to judge yet (for example no telemetry); neither pass nor fail. */
  skipped?: boolean
  unreachable?: boolean
}

export const REQUIRED_REPORT_KEYS = ['scoring', 'mcpServers', 'runs', 'skill', 'skills', 'totals'].filter(
  (key) => key !== 'skill',
)
export const REQUIRED_SCORING_KEYS = ['weights', 'weightsPercent', 'thresholds', 'minSamples']
export const STALE_HINT =
  'the running host still serves an older plugin generation: quit and reopen DeepSeek Harness once'
export const UNREACHABLE_HINT =
  'cannot reach the harness host: pass the current base URL as an argument or export DSH_WEB_URL (the GUI port changes on every launch)'

function isUnreachable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { unreachable?: unknown }).unreachable === true)
}

function result(id: string, ok: boolean, detail: string): CheckResult {
  return { id, ok, detail }
}

function skippedResult(id: string, detail: string): CheckResult {
  return { id, ok: true, skipped: true, detail }
}

/** Pure shape check over a `/skill-eval/data` payload. */
export function checkReportPayload(payload: Json): CheckResult[] {
  const results: CheckResult[] = []
  if (!payload || typeof payload !== 'object') {
    return [result('report-shape', false, 'response is not a JSON object')]
  }
  const missing = REQUIRED_REPORT_KEYS.filter((key) => !(key in payload))
  results.push(
    result(
      'report-shape',
      missing.length === 0,
      missing.length === 0 ? 'has scoring, mcpServers, runs, totals' : `missing ${missing.join(', ')} — ${STALE_HINT}`,
    ),
  )
  const scoring = payload.scoring && typeof payload.scoring === 'object' ? payload.scoring : null
  const scoringMissing = scoring ? REQUIRED_SCORING_KEYS.filter((key) => !(key in scoring)) : REQUIRED_SCORING_KEYS
  results.push(
    result(
      'scoring-block',
      scoringMissing.length === 0,
      scoringMissing.length === 0
        ? `weights ${JSON.stringify(scoring.weightsPercent)} · A≥${scoring.thresholds.excellent}`
        : `missing ${scoringMissing.join(', ')}`,
    ),
  )
  if (scoring && scoring.weightsPercent) {
    const sum = Object.values(scoring.weightsPercent).reduce((a: number, b) => a + Number(b || 0), 0)
    results.push(result('weights-normalised', Math.abs(sum - 100) <= 1, `weights sum to ${sum}`))
  }
  results.push(
    result(
      'mcp-board',
      Array.isArray(payload.mcpServers),
      `mcpServers is an array (${(payload.mcpServers || []).length} row(s))`,
    ),
  )
  results.push(
    result('runs-board', Array.isArray(payload.runs), `runs is an array (${(payload.runs || []).length} row(s))`),
  )
  results.push(
    result(
      'ranking',
      'ranking' in payload,
      'ranking' in payload ? `significant=${payload.ranking?.significant}` : 'missing ranking block',
    ),
  )
  const scored = (payload.skills || []).filter((entry: Json) => entry.score && typeof entry.score.total === 'number')
  const withCi = scored.filter((entry: Json) => entry.score.ci)
  results.push(
    result(
      'score-ci',
      scored.length === 0 || withCi.length > 0,
      scored.length === 0
        ? 'no scored skills yet'
        : `${withCi.length}/${scored.length} scored skill(s) carry a 95% interval`,
    ),
  )
  return results
}

/** File-side checks: snapshot and telemetry live under the profile data dir. */
export function checkFileState({
  eventsPath,
  snapshotMarkdownPath,
  snapshotJsonPath,
  events,
  snapshotText,
  snapshotJsonText,
}: {
  eventsPath?: string
  snapshotMarkdownPath?: string
  snapshotJsonPath?: string
  events?: Json[] | null
  snapshotText?: string | null
  snapshotJsonText?: string | null
}): CheckResult[] {
  const results: CheckResult[] = []
  const lines: Json[] = Array.isArray(events) ? events : []
  const counts: Record<string, number> = {}
  for (const record of lines) {
    const type = record && record.t ? record.t : 'unknown'
    counts[type] = (counts[type] || 0) + 1
  }
  const missingMarkdown = snapshotText === null || snapshotText === undefined
  const missingJson = snapshotJsonText === null || snapshotJsonText === undefined
  if (lines.length === 0 && missingMarkdown && missingJson) {
    // A profile that has never recorded a turn has no store files at all.
    // Nothing is wrong yet: report every store check as SKIP.
    results.push(
      skippedResult('telemetry-file', `${eventsPath ?? 'events.jsonl'} has no telemetry yet — load a skill and re-run`),
      skippedResult(
        'snapshot-markdown',
        `${snapshotMarkdownPath ?? 'reports/latest.md'} has no snapshot yet — load a skill and re-run`,
      ),
      skippedResult(
        'snapshot-json',
        `${snapshotJsonPath ?? 'reports/latest.json'} has no snapshot yet — load a skill and re-run`,
      ),
    )
    return results
  }
  if (lines.length === 0) {
    results.push(
      skippedResult('telemetry-file', `${eventsPath ?? 'events.jsonl'} has no telemetry yet — load a skill and re-run`),
    )
  } else {
    results.push(result('telemetry-file', true, `${eventsPath}: ${lines.length} record(s) ${JSON.stringify(counts)}`))
  }
  results.push(
    result(
      'snapshot-markdown',
      typeof snapshotText === 'string' && snapshotText.includes('Skill execution report'),
      typeof snapshotText === 'string'
        ? `${snapshotMarkdownPath} (${snapshotText.length} bytes)`
        : `${snapshotMarkdownPath} missing`,
    ),
  )
  let parsed: Json = null
  try {
    parsed = typeof snapshotJsonText === 'string' ? JSON.parse(snapshotJsonText) : null
  } catch {
    parsed = null
  }
  results.push(
    result(
      'snapshot-json',
      parsed !== null,
      parsed === null
        ? `${snapshotJsonPath} missing or invalid`
        : `${snapshotJsonPath} has ${(parsed.skills || []).length} skill(s)`,
    ),
  )
  if (parsed) {
    const modern = ['scoring', 'ranking', 'runs', 'mcpServers'].filter((key) => key in parsed)
    results.push(
      result(
        'snapshot-generation',
        modern.length >= 3,
        modern.length >= 3
          ? `snapshot carries ${modern.join(', ')}`
          : `snapshot lacks ${['scoring', 'ranking', 'runs', 'mcpServers'].filter((key) => !(key in parsed)).join(', ')} — this generation predates the current boards`,
      ),
    )
  }
  return results
}

/** Compose the whole acceptance run over injected IO so it stays testable. */
export async function runAcceptance({
  baseUrl,
  fetchReport,
  fetchVersioned,
  fetchConfigPage,
  fetchSettingsApi,
  readFiles,
}: {
  baseUrl?: string | null
  fetchReport?: () => Promise<Json>
  fetchVersioned?: () => Promise<Json>
  fetchConfigPage?: () => Promise<string>
  fetchSettingsApi?: () => Promise<Json>
  readFiles?: () => Promise<Parameters<typeof checkFileState>[0]>
}) {
  const results: CheckResult[] = []
  let canonical: Json = null
  if (typeof fetchReport === 'function') {
    try {
      canonical = await fetchReport()
      results.push(...checkReportPayload(canonical))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const entry = result('report-fetch', false, message)
      if (isUnreachable(error) || /fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(message)) {
        entry.unreachable = true
      }
      results.push(entry)
    }
  }
  if (typeof fetchVersioned === 'function') {
    try {
      const versioned = await fetchVersioned()
      const same =
        canonical && versioned && canonical.totals
          ? canonical.totals.invocations === versioned.totals?.invocations
          : Boolean(versioned && 'scoring' in versioned)
      results.push(
        result(
          'versioned-route',
          same,
          same
            ? 'the versioned data route answers with the same report'
            : 'versioned data route answers with a different generation',
        ),
      )
      results.push(...checkVersionedPayload(versioned, canonical))
      if (typeof fetchSettingsApi === 'function') {
        try {
          results.push(checkSettingsApi(await fetchSettingsApi()))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const entry = result('settings-api', false, message)
          if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) entry.unreachable = true
          results.push(entry)
        }
      }
      if (typeof fetchConfigPage === 'function') {
        try {
          results.push(checkConfigPage(await fetchConfigPage()))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const entry = result('config-page', false, message)
          if (/fetch failed|ECONNREFUSED|ENOTFOUND/i.test(message)) entry.unreachable = true
          results.push(entry)
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const entry = result('versioned-route', false, `${message} — the running host predates the versioned alias`)
      if (isUnreachable(error) || /fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/i.test(message)) {
        entry.unreachable = true
      }
      results.push(entry)
    }
  }
  if (typeof readFiles === 'function') {
    try {
      const files = await readFiles()
      results.push(...checkFileState(files))
    } catch (error) {
      results.push(result('files', false, error instanceof Error ? error.message : String(error)))
    }
  }
  results.push(
    result(
      'client-surface',
      true,
      'manual: load a skill in a turn — a result strip should appear under that completed turn (scores, calls/errors, expandable fixes). The popup is opt-in via window.__SEV_ENABLE_POPUP__.',
    ),
  )
  const failed = results.filter((item) => !item.ok)
  const skipped = results.filter((item) => item.skipped)
  const unreachable = results.filter((item) => item.unreachable)
  const onlyUnreachable = failed.length > 0 && failed.every((item) => item.unreachable)
  // Only generation-shape failures point at a stale host; a missing data file
  // must not tell the user to restart for nothing.
  const stale = failed.some((item) => {
    if (item.unreachable) return false
    if (['report-shape', 'versioned-route', 'canonical-route', 'snapshot-generation'].includes(item.id)) return true
    return item.id === 'report-fetch' && /route missing|text\/html|HTTP 404/i.test(item.detail)
  })
  return {
    baseUrl,
    ok: failed.length === 0,
    results,
    summary:
      failed.length === 0
        ? skipped.length > 0
          ? `PASS (${skipped.length} skipped — no telemetry yet)`
          : 'PASS'
        : onlyUnreachable || unreachable.length === failed.length
          ? `UNREACHABLE (${failed.length}) — ${UNREACHABLE_HINT}`
          : stale
            ? `FAIL (${failed.length}) — ${STALE_HINT}`
            : `FAIL (${failed.length}) — check the failed rows above`,
  }
}

/**
 * In-process acceptance: runs from inside the host (a slash command), so it
 * needs no HTTP hop. It reuses the report shape checks and adds the pieces only
 * the host can read directly: plugin version, run intervals, file generation.
 */
export function checkInProcessReport(
  report: Json,
  options: { version?: unknown; files?: Parameters<typeof checkFileState>[0] | null } = {},
) {
  const results: CheckResult[] = []
  results.push(result('plugin-version', true, String(options.version ?? 'unknown')))
  results.push(...checkReportPayload(report))
  const runs = Array.isArray(report?.runs) ? report.runs : []
  const runsWithCi = runs.filter((run: Json) => run && run.score && run.score.ci)
  results.push(
    result(
      'run-ci',
      runs.length === 0 || runsWithCi.length > 0,
      runs.length === 0 ? 'no runs yet' : `${runsWithCi.length}/${runs.length} run(s) carry an interval`,
    ),
  )
  const files = options.files
  if (files) results.push(...checkFileState(files))
  results.push(
    result(
      'client-surface',
      true,
      'manual: load a skill in a turn — the result strip renders under that completed turn',
    ),
  )
  const failed = results.filter((item) => !item.ok)
  const skipped = results.filter((item) => item.skipped)
  return {
    ok: failed.length === 0,
    results,
    summary:
      failed.length === 0
        ? skipped.length > 0
          ? `PASS (${skipped.length} skipped — no telemetry yet)`
          : 'PASS'
        : `FAIL (${failed.length})`,
  }
}

/** The settings API backs the native plugin-config page. */
export function checkSettingsApi(payload: Json): CheckResult {
  const fields = Array.isArray(payload?.fields) ? payload.fields : []
  const values = payload && typeof payload.values === 'object' ? payload.values : null
  const ok = fields.length > 0 && values !== null && fields.some((field: Json) => field.key === 'weights.static')
  return result(
    'settings-api',
    ok,
    ok
      ? `${fields.length} field(s) served, weights.static=${values['weights.static']}`
      : 'settings API did not return fields/values',
  )
}

/** The settings page must exist, or the board cannot be configured from the browser. */
export function checkConfigPage(html: unknown): CheckResult {
  const required = ['name="weights.static"', 'name="minSamples"', 'name="adviceNoiseFloor"']
  const missing = required.filter((needle) => !String(html ?? '').includes(needle))
  return result(
    'config-page',
    missing.length === 0,
    missing.length === 0 ? 'settings page serves every core field' : `settings page is missing: ${missing.join(', ')}`,
  )
}

/**
 * Checks that can only run against the versioned route: it is the one a hot
 * reload can always reclaim, so it is the honest signal of "current generation".
 */
export function checkVersionedPayload(versioned: Json, canonical: Json): CheckResult[] {
  const results: CheckResult[] = []
  const skills = Array.isArray(versioned?.skills) ? versioned.skills : []
  const tokenAware = skills.some((entry: Json) => entry && entry.stats && 'tokensPerLoad' in entry.stats)
  results.push(
    result(
      'token-accounting',
      skills.length === 0 || tokenAware,
      skills.length === 0
        ? 'no scored skills to inspect'
        : tokenAware
          ? 'skill stats carry tokensPerLoad (1.2.0+)'
          : 'skill stats have no token fields — older generation',
    ),
  )
  const canonicalKeys = canonical && typeof canonical === 'object' ? Object.keys(canonical).sort().join(',') : ''
  const versionedKeys = versioned && typeof versioned === 'object' ? Object.keys(versioned).sort().join(',') : ''
  results.push(
    result(
      'canonical-route',
      canonicalKeys === versionedKeys,
      canonicalKeys === versionedKeys
        ? 'canonical and versioned routes agree'
        : 'canonical route still answers from an older handler (the versioned route is current; a restart fixes the canonical one)',
    ),
  )
  return results
}

/** Pick the base URL: explicit argument, environment, then the relay bridge record. */
export function pickBaseUrl(
  explicit: unknown,
  envUrl: unknown,
  bridge: Json,
): { baseUrl: string | null; source: 'argument' | 'DSH_WEB_URL' | 'relay-bridge' | 'none' } {
  const clean = (value: unknown) =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim().replace(/\/$/, '') : null
  const fromArg = clean(explicit)
  if (fromArg) return { baseUrl: fromArg, source: 'argument' }
  const fromEnv = clean(envUrl)
  if (fromEnv) return { baseUrl: fromEnv, source: 'DSH_WEB_URL' }
  if (bridge && typeof bridge === 'object') {
    const upstream = clean(bridge.upstream)
    if (upstream) return { baseUrl: upstream, source: 'relay-bridge' }
  }
  return { baseUrl: null, source: 'none' }
}
