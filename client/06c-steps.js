// Per-turn loop trajectory. The host records one scored row per agent step;
// this view shows the overall picture, a skill-filtered drill-down, and the
// recent-turn comparison the panel was missing.
function stepClock(at) {
  return Number.isFinite(at) ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'
}

function stepDeltaTone(delta) {
  if (!Number.isFinite(delta) || Math.abs(delta) < 0.05) return 'flat'
  return delta > 0 ? 'up' : 'down'
}

function StepKpi(props) {
  return h('div', { className: 'sev-kpi' }, h('b', null, props.value), h('span', null, props.label))
}

function StepRow(props) {
  const { step, previous, t } = props
  const score = step.score || {}
  const delta =
    previous && Number.isFinite(previous.score?.total)
      ? Math.round((score.total - previous.score.total) * 10) / 10
      : null
  const meta = [
    `${step.toolCalls} ${t.stepCalls}`,
    step.errors > 0 ? `${step.errors} ${t.stepErrors}` : null,
    step.durationMs > 0 ? `${Math.round(step.durationMs / 100) / 10}s` : null,
    step.tokens?.calls > 0 ? `${step.tokens.input + step.tokens.output} ${t.stepTokens}` : null,
  ].filter(Boolean)
  return h(
    'li',
    { className: 'sev-step' },
    h(
      'span',
      {
        className: 'sev-step-score',
        style: { color: scoreColor(score.total), borderColor: scoreColor(score.total) },
        title: (score.penalties || []).map((item) => `${item.id} −${item.penalty}`).join(', '),
      },
      fmt(score.total),
    ),
    h(
      'div',
      { className: 'sev-step-main' },
      h(
        'div',
        { className: 'sev-step-title' },
        `${t.stepStep} ${step.step ?? '?'} · ${meta.join(' · ')}`,
        delta !== null
          ? h(
              'span',
              { className: 'sev-step-delta sev-step-delta--' + stepDeltaTone(delta) },
              (delta > 0 ? '+' : '') + delta,
            )
          : null,
      ),
      h(
        'div',
        { className: 'sev-step-sub' },
        (step.skills || []).length > 0
          ? step.skills.map((skill) =>
              h(
                'button',
                {
                  key: skill,
                  type: 'button',
                  className: 'sev-step-skill',
                  onClick: () => props.onFilter(skill),
                  title: t.stepFiltered,
                },
                skill,
              ),
            )
          : h('span', { className: 'sev-muted' }, t.stepNoSkill),
        (step.errorNames || []).length > 0
          ? h('span', { className: 'sev-step-err' }, step.errorNames.join(', '))
          : null,
      ),
    ),
  )
}

function StepTurn(props) {
  const { turn, t, previousAverage, onFilter } = props
  const delta =
    Number.isFinite(previousAverage) && Number.isFinite(turn.average) ? turn.average - previousAverage : null
  const trend = turn.steps.map((step) => ({ total: step.score?.total }))
  return h(
    'section',
    { className: 'sev-turn' },
    h(
      'header',
      { className: 'sev-turn-head' },
      h('b', null, `${t.stepTurn} ${turn.turn ?? '?'} · ${stepClock(turn.lastAt)}`),
      h(
        'span',
        { className: 'sev-turn-meta' },
        `${turn.steps.length} ${t.stepStep} · ${turn.skills.join(', ') || '—'}`,
      ),
      h(TrendSparkline, { trend, t }),
      h(
        'span',
        { className: 'sev-turn-avg', style: { color: scoreColor(turn.average) } },
        `${t.stepTurnAvg} ${fmt(turn.average)}`,
      ),
      delta !== null
        ? h(
            'span',
            { className: 'sev-turn-delta sev-step-delta--' + stepDeltaTone(Math.round(delta * 10) / 10) },
            `${t.stepDelta} ${delta > 0 ? '+' : ''}${Math.round(delta * 10) / 10}`,
          )
        : null,
    ),
    h(
      'ol',
      { className: 'sev-steplist' },
      turn.steps.map((step, index) =>
        h(StepRow, { key: `${step.step}-${step.at}`, step, previous: turn.steps[index - 1], t, onFilter }),
      ),
    ),
  )
}

function StepsView(props) {
  const { data, t } = props
  const filter = props.filter || ''
  const allSteps = (data && Array.isArray(data.steps) ? data.steps : [])
    .slice()
    .sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  const filterSkills = [...new Set(allSteps.flatMap((step) => step.skills || []))].sort()
  const steps = filter ? allSteps.filter((step) => (step.skills || []).includes(filter)) : allSteps
  const allTurns = data && Array.isArray(data.stepTurns) ? data.stepTurns : []
  const stepKey = (step) => `${step.sessionId}#${step.turn}#${step.step}#${step.at}`
  const visibleKeys = new Set(steps.map(stepKey))
  const turns = allTurns
    .map((turn) => ({ ...turn, steps: (turn.steps || []).filter((step) => visibleKeys.has(stepKey(step))) }))
    .filter((turn) => turn.steps.length > 0)
  const scores = steps.map((step) => step.score?.total).filter((value) => Number.isFinite(value))
  const average = scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null
  const latest = turns[0] || null
  const previous = turns[1] || null
  const delta =
    latest && previous && Number.isFinite(latest.average) && Number.isFinite(previous.average)
      ? Math.round((latest.average - previous.average) * 10) / 10
      : null
  const recent = turns.slice(0, 5)
  const maxRecent = Math.max(1, ...recent.map((turn) => turn.average || 0))
  return h(
    'div',
    { className: 'sev-steps' },
    steps.length === 0
      ? h('div', { className: 'sev-empty' }, t.stepNoData)
      : h(
          React.Fragment,
          null,
          h(
            'div',
            { className: 'sev-steps-kpis' },
            h(StepKpi, { label: t.stepKpiAvg, value: average === null ? '—' : fmt(average) }),
            h(StepKpi, {
              label: t.stepKpiLatest,
              value:
                latest && latest.average !== null
                  ? `${t.stepTurn} ${latest.turn ?? '?'} · ${fmt(latest.average)}` +
                    (delta !== null ? ` (${delta > 0 ? '+' : ''}${delta})` : '')
                  : '—',
            }),
            h(StepKpi, {
              label: t.stepKpiCount,
              value: `${scores.length} ${t.stepStep} / ${allTurns.length} ${t.stepTurn}`,
            }),
          ),
          h(
            'div',
            { className: 'sev-recent' },
            h('b', null, t.stepRecent),
            recent.map((turn) =>
              h(
                'div',
                { key: `${turn.sessionId}-${turn.turn}`, className: 'sev-recent-turn' },
                h('span', null, `${t.stepTurn} ${turn.turn ?? '?'}`),
                h('i', {
                  style: {
                    width: `${Math.max(4, ((turn.average || 0) / maxRecent) * 100)}%`,
                    background: scoreColor(turn.average),
                  },
                }),
                h('em', null, fmt(turn.average)),
              ),
            ),
          ),
          h(
            'div',
            { className: 'sev-step-filters' },
            h('b', null, t.stepFilter),
            h(
              'button',
              {
                type: 'button',
                className: 'sev-chip' + (filter === '' ? ' sev-chip--on' : ''),
                onClick: () => props.onFilter(''),
              },
              t.stepAll,
            ),
            filterSkills.map((skill) =>
              h(
                'button',
                {
                  key: skill,
                  type: 'button',
                  className: 'sev-chip' + (filter === skill ? ' sev-chip--on' : ''),
                  onClick: () => props.onFilter(skill),
                },
                skill,
              ),
            ),
          ),
          h('div', { className: 'sev-step-formula' }, t.stepFormula),
          turns.length === 0
            ? h('div', { className: 'sev-empty' }, filter ? t.noMatch : t.stepNoData)
            : turns.map((turn, index) =>
                h(StepTurn, {
                  key: `${turn.sessionId}-${turn.turn}`,
                  turn,
                  t,
                  previousAverage: turns[index + 1]?.average ?? null,
                  onFilter: props.onFilter,
                }),
              ),
        ),
  )
}
