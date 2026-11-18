// Pure-SVG charts for the board panel. No chart library: the bundle stays a
// single self-contained file, and every chart gets an aria-label with its data.
const CHART_COLORS = { green: '#2f9e44', yellow: '#d97706', amber: '#c9a227', red: '#c92a2a', blue: '#4d6bfe' }

function ChartCard(props: { title: string; hint?: string; solo?: boolean; children?: ReactNode }) {
  return h(
    'section',
    { className: props.solo ? 'sev-chart sev-chart--solo' : 'sev-chart' },
    h(
      'header',
      { className: 'sev-chart-head' },
      h('b', null, props.title),
      props.hint ? h('span', null, props.hint) : null,
    ),
    props.children,
  )
}

function chartEmpty(t: Texts) {
  return h('div', { className: 'sev-chart-empty' }, t.noChartData)
}

function ScoreHistogram(props: { skills: SkillData[]; t: Texts }) {
  const { skills, t } = props
  const values = (skills || []).map((entry) => entry.score?.total).filter(isNum)
  if (values.length === 0) return h(ChartCard, { title: t.chartScoreDist }, chartEmpty(t))
  const buckets = [
    { label: '0–59', min: 0, max: 59.999 },
    { label: '60–69', min: 60, max: 69.999 },
    { label: '70–79', min: 70, max: 79.999 },
    { label: '80–89', min: 80, max: 89.999 },
    { label: '90–100', min: 90, max: 100 },
  ]
  const counts = buckets.map((bucket) => values.filter((value) => value >= bucket.min && value <= bucket.max).length)
  const max = Math.max(1, ...counts)
  const average = values.reduce((sum, value) => sum + value, 0) / values.length
  const width = 300
  const height = 124
  const pad = 22
  const barWidth = (width - pad * 2) / buckets.length
  const plotHeight = height - pad - 18
  const averageY = height - pad - (Math.max(0, Math.min(100, average)) / 100) * plotHeight
  return h(
    ChartCard,
    { title: t.chartScoreDist, hint: `${values.length} ${t.skillsWord}` },
    h(
      'svg',
      {
        className: 'sev-chart-svg',
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': `${t.chartScoreDist}: ${buckets.map((bucket, index) => `${bucket.label} ${counts[index]}`).join(', ')}`,
      },
      counts.map((count, index) => {
        const barHeight = count === 0 ? 0 : Math.max(2, (count / max) * plotHeight)
        const x = pad + index * barWidth + 6
        return h(
          'g',
          { key: buckets[index].label },
          h('rect', {
            x,
            y: height - pad - barHeight,
            width: Math.max(4, barWidth - 12),
            height: barHeight,
            rx: 3,
            fill: scoreColor(buckets[index].max),
            opacity: count === 0 ? 0.18 : 0.9,
          }),
          count > 0
            ? h(
                'text',
                {
                  x: x + Math.max(4, barWidth - 12) / 2,
                  y: height - pad - barHeight - 4,
                  textAnchor: 'middle',
                  fontSize: 9,
                  fill: 'currentColor',
                },
                String(count),
              )
            : null,
          h(
            'text',
            {
              x: x + Math.max(4, barWidth - 12) / 2,
              y: height - 6,
              textAnchor: 'middle',
              fontSize: 8,
              fill: 'currentColor',
              opacity: 0.65,
            },
            buckets[index].label,
          ),
        )
      }),
      h('line', {
        x1: pad,
        x2: width - pad,
        y1: averageY,
        y2: averageY,
        stroke: CHART_COLORS.blue,
        strokeWidth: 1.5,
        strokeDasharray: '4 3',
      }),
      h(
        'text',
        { x: width - pad, y: Math.max(10, averageY - 4), textAnchor: 'end', fontSize: 9, fill: CHART_COLORS.blue },
        `${t.chartAvg} ${fmt(average)}`,
      ),
    ),
  )
}

function TrendSparkline(props: { trend?: SkillData['trend']; t: Texts }) {
  const { trend, t } = props
  const points = (trend || []).filter((point): point is { total: number } => isNum(point?.total)).slice(-12)
  if (points.length < 2) return null
  const width = 88
  const height = 24
  const values = points.map((point) => point.total)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(1, max - min)
  const coords = values.map((value, index) => [
    2 + (index * (width - 4)) / (values.length - 1),
    height - 3 - ((value - min) / span) * (height - 6),
  ])
  const first = values[0]
  const last = values[values.length - 1]
  const color = last > first + 1 ? CHART_COLORS.green : last < first - 1 ? CHART_COLORS.red : CHART_COLORS.yellow
  return h(
    'svg',
    {
      className: 'sev-spark',
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': `${t.chartTrend}: ${values.map((value) => Math.round(value)).join(' → ')}`,
    },
    h('polyline', {
      points: coords.map((point) => point.join(',')).join(' '),
      fill: 'none',
      stroke: color,
      strokeWidth: 2,
      strokeLinejoin: 'round',
      strokeLinecap: 'round',
    }),
    h('circle', { cx: coords[coords.length - 1][0], cy: coords[coords.length - 1][1], r: 2.5, fill: color }),
  )
}

function ValidityDonut(props: { validity?: ReportData['validity'] | null; t: Texts }) {
  const { validity, t } = props
  const coverage: NonNullable<NonNullable<ReportData['validity']>['coverage']> = (validity && validity.coverage) || {}
  const total = Number(coverage.skills) || 0
  if (total === 0) return h(ChartCard, { title: t.chartValidity }, chartEmpty(t))
  const withCI = Math.min(total, Number(coverage.withCI) || 0)
  const provisional = Math.min(total - withCI, Number(coverage.provisional) || 0)
  const rest = Math.max(0, total - withCI - provisional)
  const segments = [
    { value: withCI, color: CHART_COLORS.green, label: t.chartWithCI },
    { value: provisional, color: CHART_COLORS.yellow, label: t.chartProvisional },
    { value: rest, color: 'var(--dsw-alias-border-l2, #d4d4d8)', label: t.chartNoEvidence },
  ].filter((segment) => segment.value > 0)
  const radius = 30
  const circumference = 2 * Math.PI * radius
  let offset = 0
  return h(
    ChartCard,
    { title: t.chartValidity, hint: `${withCI}/${total} ${t.chartWithCI}` },
    h(
      'div',
      { className: 'sev-donut-wrap' },
      h(
        'svg',
        {
          className: 'sev-donut',
          viewBox: '0 0 84 84',
          role: 'img',
          'aria-label': segments.map((segment) => `${segment.label} ${segment.value}`).join(', '),
        },
        h('circle', { cx: 42, cy: 42, r: radius, fill: 'none', stroke: '#e4e4e7', strokeWidth: 9, opacity: 0.45 }),
        segments.map((segment) => {
          const length = (segment.value / total) * circumference
          const circle = h('circle', {
            key: segment.label,
            cx: 42,
            cy: 42,
            r: radius,
            fill: 'none',
            stroke: segment.color,
            strokeWidth: 9,
            strokeDasharray: `${length} ${circumference - length}`,
            strokeDashoffset: -offset,
            transform: 'rotate(-90 42 42)',
            strokeLinecap: 'butt',
          })
          offset += length
          return circle
        }),
        h(
          'text',
          { x: 42, y: 39, textAnchor: 'middle', fontSize: 15, fontWeight: 700, fill: 'currentColor' },
          String(withCI),
        ),
        h(
          'text',
          { x: 42, y: 52, textAnchor: 'middle', fontSize: 8, fill: 'currentColor', opacity: 0.65 },
          `${t.chartWithCI}`,
        ),
      ),
      h(
        'ul',
        { className: 'sev-chart-legend' },
        segments.map((segment) =>
          h(
            'li',
            { key: segment.label },
            h('i', { style: { background: segment.color } }),
            segment.label,
            h('b', null, ` ${segment.value}`),
          ),
        ),
        h(
          'li',
          null,
          h('i', { style: { background: CHART_COLORS.blue } }),
          `${t.chartActionable} ${coverage.actionable ?? 0}`,
        ),
      ),
    ),
  )
}

function fmtMs(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
  if (value >= 1000) {
    const seconds = value / 1000
    return (Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)) + 's'
  }
  return Math.round(value) + 'ms'
}

function McpLatencyChart(props: {
  servers?: ReportData['mcpServers'] | null
  t: Texts
  solo?: boolean
  thresholdMs?: number | null
}) {
  const { servers, t, solo } = props
  const rows = (servers || []).filter((row) => (row.calls || 0) > 0).slice(0, 8)
  if (rows.length === 0) return h(ChartCard, { title: t.chartMcp }, chartEmpty(t))
  // The alert line follows the configured MCP p95 threshold; 3000 is only the
  // fallback for an older host payload that predates the `mcp` block.
  const configured = Number(props.thresholdMs)
  const threshold = Number.isFinite(configured) && configured > 0 ? configured : 3000
  const peak = Math.max(threshold, ...rows.map((row) => Math.max(row.p50Ms || 0, row.p95Ms || 0)))
  const scale = peak * 1.05
  const width = (value: number | null | undefined) => Math.max(1.5, Math.min(100, ((value || 0) / scale) * 100)) + '%'
  return h(
    ChartCard,
    { title: t.chartMcp, hint: t.chartThreshold + ' ' + fmtMs(threshold), solo },
    h(
      'div',
      { className: 'sev-lat' },
      rows.map((row) =>
        h(
          'div',
          {
            key: row.server,
            className: 'sev-lat-row',
            role: 'img',
            'aria-label':
              row.server +
              ': ' +
              t.chartP50 +
              ' ' +
              fmtMs(row.p50Ms) +
              ', ' +
              t.chartP95 +
              ' ' +
              fmtMs(row.p95Ms) +
              ', ' +
              t.chartThreshold +
              ' ' +
              fmtMs(threshold),
          },
          h(
            'div',
            { className: 'sev-lat-head' },
            h('b', null, row.server),
            h('span', null, t.chartP50 + ' ' + fmtMs(row.p50Ms) + ' · ' + t.chartP95 + ' ' + fmtMs(row.p95Ms)),
          ),
          h(
            'div',
            { className: 'sev-meter' },
            h('i', { className: 'sev-meter-fill sev-meter-fill--p95', style: { width: width(row.p95Ms) } }),
            h('i', { className: 'sev-meter-fill sev-meter-fill--p50', style: { width: width(row.p50Ms) } }),
            h('span', { className: 'sev-meter-threshold', style: { left: width(threshold) } }),
          ),
        ),
      ),
      h(
        'ul',
        { className: 'sev-chart-legend' },
        h('li', null, h('i', { style: { background: CHART_COLORS.blue } }), t.chartP50),
        h('li', null, h('i', { style: { background: CHART_COLORS.yellow } }), t.chartP95),
        h('li', null, h('i', { style: { background: CHART_COLORS.red } }), t.chartThreshold + ' ' + fmtMs(threshold)),
      ),
    ),
  )
}

function SessionActivityChart(props: { runs?: ReportData['runs'] | null; t: Texts; solo?: boolean }) {
  const { runs, t, solo } = props
  const rows = [...(runs || [])]
    .filter((run): run is typeof run & { lastAt: number } => isNum(run.lastAt))
    .sort((a, b) => a.lastAt - b.lastAt)
    .slice(-12)
  if (rows.length === 0) return h(ChartCard, { title: t.chartSessions }, chartEmpty(t))
  const width = 300
  const height = 104
  const pad = 18
  const plot = height - pad - 14
  const max = Math.max(1, ...rows.map((run) => (run.toolCalls || 0) + (run.loads || 0)))
  const barWidth = (width - pad * 2) / rows.length
  const totals = rows.reduce(
    (sum, run) => ({
      loads: sum.loads + (run.loads || 0),
      calls: sum.calls + (run.toolCalls || 0),
      errors: sum.errors + (run.errors || 0),
    }),
    { loads: 0, calls: 0, errors: 0 },
  )
  return h(
    ChartCard,
    { title: t.chartSessions, hint: `${rows.length} ${t.chartSessionsUnit}`, solo },
    h(
      'svg',
      {
        className: 'sev-chart-svg',
        viewBox: `0 0 ${width} ${height}`,
        role: 'img',
        'aria-label': rows
          .map(
            (run) =>
              `${new Date(run.lastAt).toLocaleTimeString()}: ${run.loads || 0} ${t.chartLoads}, ${run.errors || 0} ${t.chartErrors}`,
          )
          .join('; '),
      },
      rows.map((run, index) => {
        const calls = run.toolCalls || 0
        const loads = run.loads || 0
        const errors = run.errors || 0
        const barHeight = Math.max(2, ((calls + loads) / max) * plot)
        const x = pad + index * barWidth + 2
        return h(
          'g',
          { key: `${run.sessionId}-${index}` },
          h('rect', {
            x,
            y: height - pad - barHeight,
            width: Math.max(3, barWidth - 4),
            height: barHeight,
            rx: 2,
            fill: CHART_COLORS.blue,
            opacity: 0.8,
          }),
          errors > 0
            ? h('rect', {
                x,
                y: height - pad - barHeight,
                width: Math.max(3, barWidth - 4),
                height: Math.max(2, Math.min(barHeight, (errors / Math.max(1, calls + loads)) * barHeight)),
                rx: 2,
                fill: CHART_COLORS.red,
              })
            : null,
        )
      }),
      h(
        'text',
        { x: pad, y: height - 3, fontSize: 8, fill: 'currentColor', opacity: 0.7 },
        `${totals.loads} ${t.chartLoads} · ${totals.calls} ${t.chartCalls} · ${totals.errors} ${t.chartErrors}`,
      ),
    ),
  )
}

function SkillsCharts(props: { data: ReportData | null; skills: SkillData[]; t: Texts }) {
  const { data, skills, t } = props
  return h(
    'div',
    { className: 'sev-charts' },
    h(ScoreHistogram, { skills, t }),
    h(ValidityDonut, { validity: data && data.validity, t }),
    h(McpLatencyChart, { servers: data && data.mcpServers, t, thresholdMs: data && data.mcp && data.mcp.p95Ms }),
    h(SessionActivityChart, { runs: data && data.runs, t }),
  )
}
