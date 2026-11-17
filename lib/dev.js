/**
 * Developer diagnostics: the "is this thing actually working" view.
 *
 * It answers the questions that cost the most time while developing the plugin:
 * which module generation is actually loaded, whether the on-disk package moved
 * ahead of it (the ESM-cache restart trap), where the data lives, which routes
 * this generation managed to claim, and whether the event store is healthy.
 *
 * Pure: everything is passed in.
 */

const TYPE_ORDER = ['skill', 'window', 'static', 'edit']

export function buildDevReport(input = {}) {
  const {
    moduleVersion = null,
    diskVersion = null,
    dataDir = null,
    settingsFile = null,
    settings = {},
    settingsErrors = [],
    config = {},
    routes = [],
    records = [],
    store = {},
    tools = [],
    inspectProvider = null,
    warnings = [],
    now = Date.now(),
  } = input

  const counts = {}
  let lastAt = null
  for (const record of records) {
    if (!record || typeof record.t !== 'string') continue
    counts[record.t] = (counts[record.t] ?? 0) + 1
    const at = Number(record.at)
    if (Number.isFinite(at) && (lastAt === null || at > lastAt)) lastAt = at
  }
  const types = Object.keys(counts).sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a)
    const bi = TYPE_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })

  const skew = typeof moduleVersion === 'string' && typeof diskVersion === 'string' && moduleVersion !== diskVersion
  const findings = []
  if (skew) {
    findings.push({
      code: 'module-skew',
      severity: 'critical',
      detail: `loaded module is ${moduleVersion} but package.json is ${diskVersion} — restart DeepSeek Harness to load the new code (disable/enable only re-runs apply on the cached module)`,
    })
  }
  if (store.failed) {
    findings.push({
      code: 'store-write-failed',
      severity: 'critical',
      detail: `event store reported a failed write: ${String(store.failed)}`,
    })
  }
  if (settingsErrors.length > 0) {
    findings.push({
      code: 'settings-invalid',
      severity: 'warning',
      detail: `${settingsErrors.length} saved value(s) were rejected and are not in effect: ${settingsErrors
        .map((item) => (item && item.key) || '?')
        .join(', ')}`,
    })
  }
  if (records.length === 0) {
    findings.push({ code: 'no-telemetry', severity: 'warning', detail: 'no events recorded yet; load a skill once' })
  }
  if (tools.length === 0) {
    findings.push({
      code: 'no-tools',
      severity: 'warning',
      detail: 'no tools registered (registerTool disabled or registration failed)',
    })
  }
  if (!inspectProvider) {
    findings.push({
      code: 'no-inspect-provider',
      severity: 'info',
      detail: 'Cordis Inspect provider not registered (registry unavailable?)',
    })
  }
  if (!routes.some((route) => route.indexOf('/settings') !== -1)) {
    findings.push({
      code: 'no-settings-route',
      severity: 'warning',
      detail: 'settings API route is not registered on this generation',
    })
  }

  return {
    generatedAt: new Date(now).toISOString(),
    versions: { module: moduleVersion, disk: diskVersion, skew },
    dataDir,
    settingsFile,
    settingsKeys: Object.keys(settings ?? {}).length,
    settingsErrors: settingsErrors.length,
    config: {
      weights: config.weights ?? null,
      thresholds: config.thresholds ?? null,
      minSamples: config.minSamples ?? null,
      tokenBudgetPerLoad: config.tokenBudgetPerLoad ?? null,
      adviceNoiseFloor: config.adviceNoiseFloor ?? null,
      enablePopup: null,
    },
    store: {
      dir: store.dir ?? dataDir,
      failed: store.failed ?? null,
      queued: Number.isFinite(store.queued) ? store.queued : null,
      records: records.length,
      counts,
      types,
      lastEventAt: lastAt,
      lastEventAgeMs: lastAt === null ? null : Math.max(0, now - lastAt),
    },
    routes: [...routes].sort(),
    tools: [...tools].sort(),
    inspectProvider,
    warnings: warnings.slice(-8),
    findings,
  }
}

export function renderDevMarkdown(dev) {
  if (!dev) return '## Developer diagnostics\n\nno data'
  const lines = ['## Developer diagnostics', '']
  lines.push(
    `module: **${dev.versions.module ?? '?'}** · on disk: **${dev.versions.disk ?? '?'}** · skew: **${
      dev.versions.skew ? 'YES — restart needed' : 'no'
    }**`,
  )
  lines.push(`data: \`${dev.dataDir ?? '?'}\``)
  if (dev.settingsFile)
    lines.push(
      `settings override: \`${dev.settingsFile}\` (${dev.settingsKeys} key(s)${
        dev.settingsErrors ? `, ${dev.settingsErrors} rejected` : ''
      })`,
    )
  lines.push(
    `store: ${dev.store.records} record(s) · types: ${dev.store.types.map((type) => `${type}×${dev.store.counts[type]}`).join(', ') || 'none'}`,
  )
  if (dev.store.lastEventAgeMs !== null) lines.push(`last event: ${Math.round(dev.store.lastEventAgeMs / 1000)}s ago`)
  lines.push(`routes: ${dev.routes.length} exact/prefix path(s)`)
  lines.push(`tools: ${dev.tools.join(', ') || 'none'}`)
  if (dev.findings.length > 0) {
    lines.push('', '### Findings')
    for (const finding of dev.findings) lines.push(`- [${finding.severity}] **${finding.code}** — ${finding.detail}`)
  } else {
    lines.push('', '### Findings', '- nothing suspicious')
  }
  if (dev.warnings.length > 0) {
    lines.push('', '### Recent warnings')
    for (const warning of dev.warnings) lines.push(`- ${warning}`)
  }
  return lines.join('\n')
}
