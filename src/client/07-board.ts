// ------------------------------------------------------------- main panel
// Same placement as the context plugin: a sidebar panel icon + a main panel
// keyed by the same id. This is the board's primary home inside DSH.
function PanelIcon(props: { size?: number; active?: boolean }) {
  const size = props && Number(props.size) > 0 ? Number(props.size) : 18
  const active = props && props.active === true
  return h('span', { style: { display: 'inline-flex', opacity: active ? 1 : 0.72 } }, h(GaugeIcon, { size }))
}

function BoardPanel() {
  const state = useStore()
  const { lang, t } = useLang()
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const [configOpen, setConfigOpen] = useState(false)
  useEffect(() => {
    ensureReport()
    return () => {
      mounted.current = false
      if (copyTimer.current) clearTimeout(copyTimer.current)
    }
  }, [])
  // Escape closes the in-panel settings dialog; the web config page stays as a
  // second surface but is unreachable from the desktop shell (window.open is
  // denied there), so the dialog is the entry point that always works.
  useEffect(() => {
    if (!configOpen) return undefined
    const opener = typeof document !== 'undefined' ? document.activeElement : null
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfigOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (opener instanceof HTMLElement) opener.focus()
    }
  }, [configOpen])
  const data = state.data
  const skills = (data && data.skills) || []
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [query, setQuery] = useState('')
  const [onlyActionable, setOnlyActionable] = useState(false)
  const copy = async () => {
    // Before the first load there is nothing to hand over; copying "{}" and
    // reporting success is worse than a disabled button.
    if (!data) return
    const ok = await copyText(JSON.stringify(data, null, 2))
    if (!mounted.current) return
    setCopyState(ok ? 'copied' : 'failed')
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopyState('idle'), 1600)
  }
  // The dialog declares aria-modal, so Tab must not walk into the board behind it.
  const trapFocus = (event: import('react').KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') return
    const focusable = [
      ...event.currentTarget.querySelectorAll<HTMLElement>(
        'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
      ),
    ].filter((node) => !(node as HTMLButtonElement).disabled && node.offsetParent !== null)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  const actionable = (data && data.validity && data.validity.coverage && data.validity.coverage.actionable) || 0
  const hasFix = (entry: SkillData) =>
    (entry.advice || []).some((item) => item.severity === 'critical' || item.severity === 'warning')
  const fixable = skills.filter(hasFix).length
  const loads = skills.reduce((total, entry) => total + (entry.stats?.loads || 0), 0)
  const scored = skills.map((entry) => entry.score?.total).filter(isNum)
  const average = scored.length > 0 ? scored.reduce((a, b) => a + b, 0) / scored.length : null
  const needle = query.trim().toLowerCase()
  const visibleSkills = skills.filter(
    (entry) =>
      (!onlyActionable || hasFix(entry)) &&
      (needle.length === 0 ||
        String(entry.skill ?? '')
          .toLowerCase()
          .includes(needle)),
  )
  const updated =
    data && data.generatedAt && Number.isFinite(Date.parse(data.generatedAt))
      ? new Date(data.generatedAt).toLocaleTimeString()
      : null
  const rankingNote =
    data && data.ranking ? (lang === 'zh' && data.ranking.noteZh ? data.ranking.noteZh : data.ranking.note) : null
  return h(
    'div',
    { className: 'sev-panel' },
    h('style', { key: 'sev-panel-style' }, STYLES + '\n' + PANEL_STYLES.join('\n')),
    h(
      'div',
      { className: 'sev-head', style: { borderBottom: 'none', padding: '0 0 6px' } },
      h(
        'div',
        { className: 'sev-head-text' },
        h('div', { className: 'sev-title' }, t.title),
        h(
          'div',
          { className: 'sev-sub' },
          skills.length +
            ' ' +
            t.detailSkills +
            ' · ' +
            actionable +
            ' ' +
            t.detailActionable +
            (updated ? ' · ' + t.updated + ' ' + updated : ''),
        ),
        h(
          'div',
          { className: 'sev-tabs', role: 'tablist' },
          (['skills', 'steps', 'runs', 'mcp', 'dev'] as ReportView[]).map((view) =>
            h(
              'button',
              {
                key: view,
                type: 'button',
                role: 'tab',
                id: 'sev-board-tab-' + view,
                'aria-controls': 'sev-board-view',
                'aria-selected': state.view === view,
                tabIndex: state.view === view ? 0 : -1,
                className: 'sev-tab' + (state.view === view ? ' sev-tab--on' : ''),
                onClick: () => setView(view),
                onKeyDown: (event: import('react').KeyboardEvent) => {
                  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
                  event.preventDefault()
                  const views: ReportView[] = ['skills', 'steps', 'runs', 'mcp', 'dev']
                  const index = views.indexOf(view)
                  const next = views[(index + (event.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length]
                  setView(next)
                  const target =
                    typeof document !== 'undefined' ? document.getElementById('sev-board-tab-' + next) : null
                  if (target) target.focus()
                },
              },
              t.tabs[view],
            ),
          ),
        ),
      ),
      h(
        'div',
        { className: 'sev-head-actions' },
        h(
          'button',
          {
            type: 'button',
            className: 'sev-btn',
            title: t.rowConfigSummary,
            onClick: () => setConfigOpen(true),
          },
          t.config,
        ),
        h('button', { type: 'button', className: 'sev-btn', onClick: load, disabled: state.loading }, t.refresh),
        h(
          'button',
          { type: 'button', className: 'sev-btn', onClick: copy, disabled: !data },
          h(
            'span',
            { role: 'status', 'aria-live': 'polite' },
            copyState === 'copied' ? t.copied : copyState === 'failed' ? t.copyFailed : t.copy,
          ),
        ),
      ),
    ),
    h(
      'div',
      { className: 'sev-kpis' },
      [
        [t.kpiSkills, skills.length],
        [t.kpiLoads, loads],
        [t.kpiFixable, fixable],
        [t.kpiAvg, average === null ? '—' : fmt(average)],
      ].map(([label, value]) =>
        h('div', { className: 'sev-kpi', key: label }, h('b', null, String(value)), h('span', null, label)),
      ),
    ),
    state.loading && !data ? h('div', { className: 'sev-empty' }, t.loading) : null,
    state.view === 'skills' && data ? h(SkillsCharts, { data, skills, t }) : null,
    data && !data.scoring
      ? h('div', { className: 'sev-stale' }, h('b', null, t.staleTitle), h('span', null, t.staleHint))
      : null,
    state.error ? h('div', { className: 'sev-error' }, t.failed + ': ' + state.error + ' — ' + DATA_URL) : null,
    data && data.totals && data.totals.storeError
      ? h('div', { className: 'sev-error' }, t.storeError + ': ' + data.totals.storeError)
      : null,
    state.view === 'skills' && rankingNote ? h('div', { className: 'sev-note' }, rankingNote) : null,
    state.view === 'skills'
      ? h(
          'div',
          { className: 'sev-filterbar' },
          h('input', {
            type: 'search',
            className: 'sev-search',
            value: query,
            placeholder: t.searchPlaceholder,
            'aria-label': t.searchPlaceholder,
            onChange: (event) => setQuery(event.target.value),
          }),
          h(
            'button',
            {
              type: 'button',
              className: 'sev-chip' + (onlyActionable ? ' sev-chip--on' : ''),
              'aria-pressed': onlyActionable,
              onClick: () => setOnlyActionable((value) => !value),
            },
            t.onlyActionable + ' (' + fixable + ')',
          ),
        )
      : null,
    h(
      'div',
      { role: 'tabpanel', id: 'sev-board-view', 'aria-labelledby': 'sev-board-tab-' + state.view },
      state.view === 'skills'
        ? !state.loading && !state.error && skills.length === 0
          ? h('div', { className: 'sev-empty' }, t.empty)
          : visibleSkills.length === 0
            ? h('div', { className: 'sev-empty' }, t.noMatch)
            : visibleSkills.map((skill) =>
                h(SkillCard, {
                  key: skill.skill,
                  skill,
                  t,
                  lang,
                  onTrace: (name) => store.set((current) => ({ ...current, view: 'steps', stepFilter: name })),
                }),
              )
        : state.view === 'steps'
          ? h(StepsView, {
              data,
              t,
              filter: state.stepFilter || '',
              onFilter: (name) => store.set((current) => ({ ...current, stepFilter: name })),
            })
          : state.view === 'runs'
            ? h(RunsView, { data, t })
            : state.view === 'mcp'
              ? h(McpView, { data, t, lang })
              : h(DevView, { data, t }),
    ),
    configOpen
      ? h(
          'div',
          {
            className: 'sev-backdrop',
            role: 'presentation',
            onMouseDown: (event: import('react').MouseEvent) => {
              if (event.target === event.currentTarget) setConfigOpen(false)
            },
          },
          h(
            'div',
            {
              className: 'sev-dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': t.config,
              onKeyDown: trapFocus,
            },
            h(
              'header',
              { className: 'sev-head' },
              h(
                'div',
                { className: 'sev-head-text' },
                h('div', { className: 'sev-title' }, t.config),
                h('div', { className: 'sev-sub' }, t.rowConfigSummary),
              ),
              h(
                'div',
                { className: 'sev-head-actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sev-btn sev-btn--icon',
                    onClick: () => setConfigOpen(false),
                    'aria-label': t.close,
                    title: t.close,
                    autoFocus: true,
                  },
                  '✕',
                ),
              ),
            ),
            h('div', { className: 'sev-body' }, h(SettingsForm, { webOpen: false })),
          ),
        )
      : null,
  )
}

const PANEL_STYLES = [
  '.sev-panel{height:100%;overflow:auto;box-sizing:border-box;padding:22px 26px 32px;display:flex;flex-direction:column;gap:14px;color:var(--dsw-alias-label-primary, #18181b);font-size:13px;line-height:1.5;background:var(--dsw-alias-bg-layer-1, transparent)}',
  '.sev-panel .sev-head{display:flex;align-items:flex-start;gap:12px}',
  '.sev-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}',
  '.sev-kpi{display:flex;flex-direction:column;gap:2px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:10px;background:var(--dsw-alias-bg-layer-2, #f4f4f5)}',
  '.sev-kpi b{font-size:18px;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary, #18181b)}',
  '.sev-kpi span{font-size:11px;color:var(--dsw-alias-label-secondary, #71717a)}',
  '.sev-filterbar{display:flex;align-items:center;gap:10px}',
  '.sev-search{flex:1;min-width:0;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:8px;background:var(--dsw-alias-bg-layer-1, #fff);color:inherit;font:inherit}',
  '.sev-search:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4d6bfe);outline-offset:1px}',
  '.sev-chip{padding:6px 10px;border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary, #71717a);font:inherit;cursor:pointer;white-space:nowrap}',
  '.sev-chip--on{border-color:var(--dsw-alias-brand-primary, #4d6bfe);color:var(--dsw-alias-brand-primary, #4d6bfe);background:var(--dsw-alias-bg-layer-2, #f4f4f5);font-weight:600}',
]

function FooterAction(props: { wide?: boolean }) {
  const { t } = useLang()
  const wide = props && props.wide !== false
  return h(
    'button',
    {
      type: 'button',
      className: wide ? 'sev-btn' : 'sev-btn sev-btn--icon',
      title: t.open,
      'aria-label': t.open,
      onClick: openReport,
    },
    h(GaugeIcon, { size: 16 }),
    wide ? h('span', null, t.open) : null,
  )
}

function DimensionBar(props: { label: string; value: number | null | undefined }) {
  const value = props.value
  const width = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0
  return h(
    'div',
    { className: 'sev-dim' },
    h('span', { className: 'sev-dim-label' }, props.label),
    h('span', { className: 'sev-dim-track' }, h('i', { style: { width: width + '%', background: scoreColor(value) } })),
    h('b', null, fmt(value)),
  )
}

const SkillCard = memo(function SkillCard(props: {
  skill: SkillData
  t: Texts
  lang?: string
  onTrace?: (skill: string) => void
}) {
  const skill = props.skill
  const t = props.t
  const lang = props.lang || 'zh'
  const score: NonNullable<SkillData['score']> = skill.score || {}
  const dims: NonNullable<typeof score.dimensions> = score.dimensions || {}
  const stats: NonNullable<SkillData['stats']> = skill.stats || {}
  const advice = (skill.topAdvice && skill.topAdvice.length ? skill.topAdvice : skill.advice || []).slice(0, 3)
  return h(
    'article',
    { className: 'sev-card' },
    h(
      'div',
      { className: 'sev-card-head' },
      h('div', { className: 'sev-name' }, skill.skill),
      h(TrendSparkline, { trend: skill.trend, t }),
      h('div', { className: 'sev-grade', style: { color: scoreColor(score.total) } }, score.grade || '?'),
      h('div', { className: 'sev-total', style: { color: scoreColor(score.total) } }, fmt(score.total)),
      h(CopySkillIssuesButton, { skill, t, lang }),
      h(
        'button',
        {
          type: 'button',
          className: 'sev-trace',
          title: t.stepTrace,
          'aria-label': t.stepTrace + ': ' + skill.skill,
          onClick: () => props.onTrace && props.onTrace(String(skill.skill)),
        },
        t.stepTrace,
      ),
    ),
    score.provisional ? h('div', { className: 'sev-provisional' }, t.provisional) : null,
    score.ci
      ? h(
          'div',
          { className: 'sev-ci' },
          '95% CI ' + fmt(score.ci.low) + ' – ' + fmt(score.ci.high) + ' · n=' + (score.samples || 0),
        )
      : null,
    h(
      'div',
      { className: 'sev-dims' },
      h(DimensionBar, { label: t.dims.static, value: dims.static }),
      h(DimensionBar, { label: t.dims.reliability, value: dims.reliability }),
      h(DimensionBar, { label: t.dims.effectiveness, value: dims.effectiveness }),
      h(DimensionBar, { label: t.dims.efficiency, value: dims.efficiency }),
    ),
    h(
      'div',
      { className: 'sev-meta' },
      (stats.loads || 0) +
        ' ' +
        t.loads +
        ' · ' +
        (stats.closed || 0) +
        ' ' +
        t.closed +
        ' · ' +
        t.corr +
        ' ' +
        pct(stats.correctionRate) +
        ' · ' +
        t.err +
        ' ' +
        pct(stats.errRate) +
        ' · ' +
        t.latency +
        ' ' +
        fmt(stats.p50LoadMs, 0) +
        'ms' +
        (typeof stats.tokensPerLoad === 'number'
          ? ' · ≈' + stats.tokensPerLoad.toLocaleString() + ' ' + t.tokPerLoad
          : ''),
    ),
    advice.length
      ? h(
          'ul',
          { className: 'sev-advice' },
          advice.map((raw, index) => {
            const item = adviceView(raw, lang)
            return h(
              'li',
              { key: item.id || String(index), style: { borderLeftColor: severityColor(item.severity) } },
              h(
                'b',
                null,
                (item.severity === 'critical' ? '🛑 ' : item.severity === 'warning' ? '⚠️ ' : 'ℹ️ ') + item.title,
              ),
              h('span', null, item.evidence),
              h('em', null, '↳ ' + item.fix),
              h(CopyIssueButton, { item, target: t.issueSkill + ' `' + skill.skill + '`', t }),
            )
          }),
        )
      : h('div', { className: 'sev-meta' }, t.noAdvice),
  )
})

function DataTable(props: { head: string[]; rows: ReactNode[][]; empty: string; variant?: string }) {
  const { head, rows, empty, variant } = props
  if (rows.length === 0) return h('div', { className: 'sev-empty' }, empty)
  return h(
    'div',
    { className: 'sev-table' + (variant ? ' sev-table--' + variant : '') },
    h(
      'div',
      { className: 'sev-tr sev-th' },
      head.map((label) => h('span', { key: label }, label)),
    ),
    rows.map((cells, index) =>
      h(
        'div',
        { className: 'sev-tr', key: String(index) },
        cells.map((cell, cellIndex) =>
          h('span', { key: String(cellIndex), className: cellIndex === 0 ? 'sev-strong' : undefined }, cell),
        ),
      ),
    ),
  )
}

function RunsView(props: { data: ReportData | null; t: Texts }) {
  const t = props.t
  const runs = props.data && Array.isArray(props.data.runs) ? props.data.runs : []
  return h(
    Fragment,
    null,
    h(SessionActivityChart, { runs, t, solo: true }),
    h(DataTable, {
      head: t.runsHead,
      empty: t.emptyRuns,
      rows: runs
        .slice(0, 12)
        .map((run) => [
          String(run.sessionId || '').slice(-8),
          h(
            'b',
            { style: { color: scoreColor(run.score && run.score.total) } },
            fmt(run.score && run.score.total) +
              ' ' +
              ((run.score && run.score.grade) || '') +
              (run.score && run.score.ci ? '  [' + fmt(run.score.ci.low) + '–' + fmt(run.score.ci.high) + ']' : ''),
          ),
          String(run.loads || 0),
          String(run.toolCalls || 0),
          String(run.errors || 0),
        ]),
    }),
  )
}

function McpView(props: { data: ReportData | null; t: Texts; lang?: string }) {
  const t = props.t
  const lang = props.lang || 'zh'
  const data: ReportData = props.data || {}
  const servers = Array.isArray(data.mcpServers) ? data.mcpServers : []
  const advice = (Array.isArray(data.mcpAdvice) ? data.mcpAdvice : []).slice(0, 6)
  const failing: Array<{ server?: string; tool?: string; errors?: number; calls?: number }> = []
  for (const row of servers) {
    for (const tool of row.tools || []) {
      if ((tool.errors || 0) > 0) failing.push({ server: row.server, ...tool })
    }
  }
  const calls = servers.reduce((total, row) => total + (row.calls || 0), 0)
  const errors = servers.reduce((total, row) => total + (row.errors || 0), 0)
  // With nothing recorded, a chart card plus an empty table card reads as two
  // broken panels; one honest empty card is the whole state.
  if (servers.length === 0 || calls === 0) {
    return h(
      'div',
      { className: 'sev-card' },
      h('header', { className: 'sev-card-head' }, h('b', null, t.tabs.mcp)),
      h('div', { className: 'sev-empty' }, t.emptyMcp),
    )
  }
  const latency = (row: (typeof servers)[number]) =>
    row.p50Ms === null || row.p50Ms === undefined
      ? '—'
      : fmtMs(row.p50Ms) + ' / ' + (row.p95Ms === null || row.p95Ms === undefined ? '—' : fmtMs(row.p95Ms))
  return h(
    Fragment,
    null,
    // No `solo` here: the chart card must line up with the table card below it,
    // and `.sev-chart--solo` caps the width at 560px.
    h(McpLatencyChart, {
      servers,
      t,
      thresholdMs: data.mcp && data.mcp.p95Ms,
    }),
    h(
      'div',
      { className: 'sev-card' },
      h(
        'header',
        { className: 'sev-card-head' },
        h('b', null, t.mcpHead[0]),
        h('span', null, servers.length + ' · ' + calls + ' ' + t.chartCalls + ' · ' + errors + ' ' + t.chartErrors),
      ),
      h(DataTable, {
        variant: 'mcp',
        head: t.mcpHead,
        empty: t.emptyMcp,
        rows: servers.map((row) => [
          row.server,
          h(
            'span',
            { className: 'sev-health' },
            h('i', { className: 'sev-grade', style: { color: scoreColor(row.health) } }, row.grade || '—'),
            fmt(row.health),
          ),
          String(row.calls || 0),
          pct(row.errorRate),
          latency(row),
        ]),
      }),
    ),
    advice.length > 0
      ? h(
          'div',
          { className: 'sev-card' },
          h('header', { className: 'sev-card-head' }, h('b', null, t.mcpFix)),
          h(
            'div',
            { className: 'sev-advice-list' },
            advice.map((raw, index) => {
              const item = adviceView(raw, lang)
              return h(
                'div',
                { className: 'sev-advice-row', key: item.id + '-' + index },
                h(
                  'b',
                  { style: { color: severityColor(item.severity) } },
                  (item.severity === 'critical' ? '🛑 ' : item.severity === 'warning' ? '⚠️ ' : 'ℹ️ ') + item.title,
                ),
                h('em', null, '↳ ' + item.fix),
                h(CopyIssueButton, {
                  item,
                  target: 'MCP `' + (item.tool ? item.server + '/' + item.tool : item.server) + '`',
                  t,
                }),
              )
            }),
          ),
        )
      : null,
    failing.length > 0
      ? h(
          'div',
          { className: 'sev-card' },
          h('header', { className: 'sev-card-head' }, h('b', null, t.mcpFailing)),
          h(
            'div',
            { className: 'sev-advice-list' },
            failing
              .slice(0, 8)
              .map((tool) =>
                h(
                  'div',
                  { className: 'sev-sub-row', key: tool.server + '/' + tool.tool },
                  h('span', null, tool.server + '/' + tool.tool),
                  h('b', null, (tool.errors || 0) + '/' + (tool.calls || 0)),
                ),
              ),
          ),
        )
      : null,
  )
}

function DevView(props: { data: ReportData | null; t: Texts }) {
  const t = props.t
  const data: ReportData = props.data || {}
  const scoring: NonNullable<ReportData['scoring']> = data.scoring || {}
  const totals: NonNullable<ReportData['totals']> = data.totals || {}
  const weights: Record<string, number | undefined> = scoring.weightsPercent || {}
  const th: NonNullable<typeof scoring.thresholds> = scoring.thresholds || {}
  const dev: NonNullable<ReportData['dev']> = data.dev || {}
  const rows = [
    [
      t.devLabels.weights,
      ['static', 'reliability', 'effectiveness', 'efficiency']
        .map((key) => key + ' ' + (weights[key] ?? '—'))
        .join(' · '),
    ],
    [
      t.devLabels.thresholds,
      'A≥' + (th.excellent ?? '—') + ' · B≥' + (th.good ?? '—') + ' · C≥' + (th.pass ?? '—') + ' · D≥60',
    ],
    [t.devLabels.minSamples, String(scoring.minSamples ?? '—')],
    [
      t.devLabels.totals,
      (totals.invocations ?? 0) +
        ' ' +
        t.devLoads +
        ' · ' +
        (totals.closed ?? 0) +
        ' ' +
        t.devClosed +
        ' · ' +
        (totals.open ?? 0) +
        ' ' +
        t.devOpen,
    ],
    [t.devLabels.dataDir, data.dataDir || '—'],
    [t.devLabels.api, DATA_URL],
    [
      t.devLabels.module,
      (dev.moduleVersion ?? '—') + ' / ' + (dev.diskVersion ?? '—') + (dev.skew ? ' ⚠ ' + t.devLabels.skew : ''),
    ],
    [t.devLabels.routes, String(dev.routes ?? '—') + ' · ' + t.devLabels.tools + ' ' + String(dev.tools ?? '—')],
    [t.devLabels.settingsFile, dev.settingsFile || '—'],
    [t.devLabels.warnings, String(dev.warnings ?? 0)],
    [t.devLabels.inspect, dev.inspectProvider ? t.devLabels.ok : '—'],
    [t.devLabels.store, totals.storeError ? String(totals.storeError) : t.devLabels.ok],
    [t.version, DATA_VERSION],
  ]
  return h(
    'div',
    { className: 'sev-kv' },
    rows.map(([label, value]) =>
      h('div', { className: 'sev-kv-row', key: label }, h('span', null, label), h('b', null, String(value))),
    ),
  )
}
