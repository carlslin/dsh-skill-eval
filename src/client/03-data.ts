// ---------------------------------------------------------------- utils
// Keep in sync with package.json `version` (a test enforces it). The host
// registers this exact path per release, so a plugin that was hot-reloaded
// without reclaiming the canonical route still answers here.
const DATA_VERSION = '1.22.0'
const DATA_URL = '/skill-eval/data/' + DATA_VERSION
const DATA_URL_FALLBACK = '/skill-eval/data'
const SETTINGS_URL = '/skill-eval/settings/' + DATA_VERSION
const SETTINGS_URL_FALLBACK = '/skill-eval/settings'

/** `Number.isFinite` as a type guard. */
const isNum = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function fmt(value: unknown, digits?: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits === undefined ? 1 : digits) : '—'
}

function pct(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) + '%' : '—'
}

function scoreColor(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'var(--dsw-alias-state-idle-primary, #a1a1aa)'
  // Colour bands follow the configured grade floors, so a 92-point skill can
  // never render green while its letter says B.
  const thresholds: { excellent?: number; pass?: number } = store.get().data?.scoring?.thresholds || {}
  const excellent = Number(thresholds.excellent) || 90
  const pass = Number(thresholds.pass) || 70
  if (value >= excellent) return 'var(--dsw-alias-state-success-primary, #2f9e44)'
  if (value >= pass) return 'var(--dsw-alias-state-warn-primary, #d97706)'
  return 'var(--dsw-alias-state-error-primary, #c92a2a)'
}

function severityColor(severity: unknown): string {
  if (severity === 'critical') return 'var(--dsw-alias-state-error-primary, #c92a2a)'
  if (severity === 'warning') return 'var(--dsw-alias-state-warn-primary, #d97706)'
  return 'var(--dsw-alias-brand-primary, #4d6bfe)'
}

type FetchError = Error & { status?: number; notJson?: boolean }

async function fetchReport(url: string): Promise<ReportData> {
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
  if (!response.ok) {
    const error: FetchError = new Error('HTTP ' + response.status)
    error.status = response.status
    throw error
  }
  const type =
    (response.headers && typeof response.headers.get === 'function' && response.headers.get('content-type')) || ''
  if (type.indexOf('json') === -1) {
    // DSH's prefix route answers 200 HTML for an unclaimed versioned subpath,
    // so a status-only fallback would never fire during a restart-skew.
    const error: FetchError = new Error(url + ' returned ' + (type || 'no content-type') + ' instead of JSON')
    error.status = response.status
    error.notJson = true
    throw error
  }
  return response.json()
}

let loadInFlight = false
let loadGeneration = 0

function load() {
  // Refresh can be clicked repeatedly and the popup polls; only one
  // request may update the store, and only the newest request wins.
  if (loadInFlight) return
  loadInFlight = true
  const generation = (loadGeneration += 1)
  const finish = (patch: Partial<AppState>) => {
    if (generation !== loadGeneration) return
    store.set((state) => ({ ...state, ...patch }))
  }
  store.set((state) => ({ ...state, loading: true, error: null }))
  fetchReport(DATA_URL)
    .catch((error: FetchError) => {
      // a host that predates the versioned alias (or a hot reload that kept
      // the canonical route) still answers on the unversioned path
      if (error && (error.status === 404 || error.notJson || error instanceof SyntaxError))
        return fetchReport(DATA_URL_FALLBACK)
      throw error
    })
    .then((data) => {
      finish({ loading: false, data, error: null, fetchedAt: Date.now() })
    })
    .catch((error) => {
      finish({ loading: false, error: error && error.message ? error.message : String(error) })
    })
    .finally(() => {
      if (generation === loadGeneration) loadInFlight = false
    })
}

const REFRESH_MS = 5000

function ensureReport() {
  const state = store.get()
  if (state.loading) return
  if (state.data && Date.now() - state.fetchedAt < 10000) return
  load()
}

// Versioned aliases survive hot reloads where the canonical route is still
// owned by an older generation; both land on the same board.
const BOARD_URL = '/skill-eval/board/' + DATA_VERSION
const CONFIG_URL = BOARD_URL + '/config'

function pagePath(kind: 'board' | 'config'): string {
  try {
    const pages = store.get().data?.pages
    const value = pages && pages[kind]
    if (typeof value === 'string' && value) return value
  } catch {
    // fall back to the default route
  }
  return kind === 'board' ? BOARD_URL : CONFIG_URL
}

function boardUrl() {
  try {
    return window.location.origin + pagePath('board')
  } catch {
    return pagePath('board')
  }
}

function configUrl() {
  try {
    return window.location.origin + pagePath('config')
  } catch {
    return pagePath('config')
  }
}

function openBoard() {
  try {
    window.open(boardUrl(), '_blank', 'noopener')
  } catch {
    // opening a tab is best effort; the link in the tooltip still works
  }
}

function openReport() {
  if (!ENABLE_POPUP) {
    openBoard()
    return
  }
  store.set((state) => ({ ...state, open: true }))
  load()
}

function setView(view: ReportView) {
  store.set((state) => ({ ...state, view }))
}

function closeReport() {
  store.set((state) => ({ ...state, open: false }))
}

function buildMarkdown(data: ReportData | null): string {
  if (!data || !Array.isArray(data.skills) || data.skills.length === 0) return '# skill eval: no data'
  const lines = ['# Skill eval report', '']
  for (const skill of data.skills) {
    const score: NonNullable<SkillData['score']> = skill.score || {}
    const dims: NonNullable<typeof score.dimensions> = score.dimensions || {}
    lines.push('## ' + skill.skill + ' — ' + fmt(score.total) + '/100 (' + (score.grade || '?') + ')')
    lines.push(
      '- static ' +
        fmt(dims.static) +
        ' · reliability ' +
        fmt(dims.reliability) +
        ' · effectiveness ' +
        fmt(dims.effectiveness) +
        ' · efficiency ' +
        fmt(dims.efficiency),
    )
    const stats: NonNullable<SkillData['stats']> = skill.stats || {}
    lines.push(
      '- loads ' +
        (stats.loads || 0) +
        ' · closed ' +
        (stats.closed || 0) +
        ' · corrections ' +
        pct(stats.correctionRate) +
        ' · tool errors ' +
        pct(stats.errRate) +
        ' · load ' +
        fmt(stats.p50LoadMs, 0) +
        'ms',
    )
    for (const item of (skill.advice || []).slice(0, 4)) {
      lines.push('- [' + item.severity + '] ' + item.title + ' — ' + item.evidence)
      lines.push('  fix: ' + item.fix)
    }
    lines.push('')
  }
  return lines.join('\n')
}
