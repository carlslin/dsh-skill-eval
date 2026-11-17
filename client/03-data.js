// ---------------------------------------------------------------- utils
// Keep in sync with package.json `version` (a test enforces it). The host
// registers this exact path per release, so a plugin that was hot-reloaded
// without reclaiming the canonical route still answers here.
const DATA_VERSION = '1.20.2'
const DATA_URL = '/skill-eval/data/' + DATA_VERSION
const DATA_URL_FALLBACK = '/skill-eval/data'
const SETTINGS_URL = '/skill-eval/settings/' + DATA_VERSION
const SETTINGS_URL_FALLBACK = '/skill-eval/settings'

function fmt(value, digits) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits === undefined ? 1 : digits) : '—'
}

function pct(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 100) + '%' : '—'
}

function scoreColor(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'var(--dsw-alias-state-idle-primary, #a1a1aa)'
  if (value >= 90) return 'var(--dsw-alias-state-success-primary, #2f9e44)'
  if (value >= 70) return 'var(--dsw-alias-state-warn-primary, #d97706)'
  return 'var(--dsw-alias-state-error-primary, #c92a2a)'
}

function severityColor(severity) {
  if (severity === 'critical') return 'var(--dsw-alias-state-error-primary, #c92a2a)'
  if (severity === 'warning') return 'var(--dsw-alias-state-warn-primary, #d97706)'
  return 'var(--dsw-alias-brand-primary, #4d6bfe)'
}

async function fetchReport(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, cache: 'no-store' })
  if (!response.ok) {
    const error = new Error('HTTP ' + response.status)
    error.status = response.status
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
  const finish = (patch) => {
    if (generation !== loadGeneration) return
    store.set((state) => ({ ...state, ...patch }))
  }
  store.set((state) => ({ ...state, loading: true, error: null }))
  fetchReport(DATA_URL)
    .catch((error) => {
      // a host that predates the versioned alias (or a hot reload that kept
      // the canonical route) still answers on the unversioned path
      if (error && error.status === 404) return fetchReport(DATA_URL_FALLBACK)
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

function boardUrl() {
  try {
    return window.location.origin + BOARD_URL
  } catch {
    return BOARD_URL
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

function setView(view) {
  store.set((state) => ({ ...state, view }))
}

function closeReport() {
  store.set((state) => ({ ...state, open: false }))
}

function buildMarkdown(data) {
  if (!data || !Array.isArray(data.skills) || data.skills.length === 0) return '# skill eval: no data'
  const lines = ['# Skill eval report', '']
  for (const skill of data.skills) {
    const score = skill.score || {}
    const dims = score.dimensions || {}
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
    const stats = skill.stats || {}
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
