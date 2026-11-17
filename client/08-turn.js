function scoreOf(data, skill) {
  const entry = ((data && data.skills) || []).find((item) => item.skill === skill)
  return entry ? entry.score || {} : null
}

/**
 * The completed-turn strip: it reads the durable per-turn skill loads from
 * the report and renders only under turns that actually loaded a skill.
 */
// The slot owner supplies `useChat` as a prop. Split it into two wrapper
// components so the hook is never called conditionally: React compares the
// returned element type, so a host that stops passing the hook remounts the
// plain wrapper instead of changing this component's hook count.
function TurnSkillCard(props) {
  return typeof props.useChat === 'function' ? h(TurnSkillCardWithChat, props) : h(TurnSkillCardPlain, { ...props })
}

function TurnSkillCardWithChat(props) {
  const nodesSnapshot = props.useChat((snapshot) => snapshot.nodes)
  return h(TurnSkillCardBody, { ...props, nodesSnapshot })
}

function TurnSkillCardPlain(props) {
  return h(TurnSkillCardBody, props)
}

function TurnSkillCardBody(props) {
  const { sessionId, turn, nodesSnapshot } = props
  const { lang, t } = useLang()
  const state = useStore()

  useEffect(() => {
    ensureReport()
  }, [sessionId, turn && turn.turn])

  if (!turn) return null
  // `status` is 'closed' on current hosts; older/other builds may omit it or
  // use a different word, so only a clearly in-flight turn is skipped.
  const status = typeof turn.status === 'string' ? turn.status.toLowerCase() : ''
  if (status && /run|stream|pending|activ|progress/.test(status)) return null
  const turnNumber =
    typeof turn.turn === 'number'
      ? turn.turn
      : typeof turn.number === 'number'
        ? turn.number
        : typeof turn.index === 'number'
          ? turn.index
          : null
  if (turnNumber === null) return null
  const data = state.data
  const rows = ((data && data.turnLoads) || []).filter((row) => row.sessionId === sessionId && row.turn === turnNumber)
  if (rows.length === 0) return null

  let toolCalls = null
  let errors = null
  if (nodesSnapshot && typeof nodesSnapshot.values === 'function') {
    const inTurn = [...nodesSnapshot.values()].filter(
      (node) => node && node.location && node.location.turn && node.location.turn.turn === turnNumber,
    )
    toolCalls = inTurn.filter((node) => node.kind === 'tool-call').length
    errors = inTurn.filter(
      (node) =>
        node.kind === 'tool-call' &&
        node.data &&
        (node.data.isError === true || (node.data.result && node.data.result.isError === true)),
    ).length
  }

  const skills = [...new Set(rows.flatMap((row) => row.skills))]
  const skillEntries = ((data && data.skills) || []).filter((entry) => skills.includes(entry.skill))
  // One next fix per loaded skill: a turn can load several skills, and the
  // strip should surface each skill's own next move instead of a single
  // global winner. Cap at three so the strip stays readable.
  const nextSteps = skillEntries
    .map((entry) => {
      const first = (entry.advice || [])
        .filter((item) => item.severity === 'critical' || item.severity === 'warning')
        .sort((a, b) => (a.severity === 'critical' ? 0 : 1) - (b.severity === 'critical' ? 0 : 1))[0]
      return first ? { ...adviceView(first, lang), skill: entry.skill } : null
    })
    .filter(Boolean)
    .slice(0, 3)
  return h(
    React.Fragment,
    null,
    h('style', { key: 'sev-turn-style' }, TURN_STYLES),
    h(
      'div',
      { className: 'sev-turn' },
      h('span', { className: 'sev-turn-label' }, t.turnLabel),
      ...skills.map((skill) => {
        const score = scoreOf(data, skill)
        return h(
          'span',
          { className: 'sev-turn-chip', key: skill },
          h('b', null, skill),
          score && typeof score.total === 'number'
            ? h('i', { style: { color: scoreColor(score.total) } }, fmt(score.total) + ' ' + (score.grade || ''))
            : null,
        )
      }),
      toolCalls !== null
        ? h(
            'span',
            { className: 'sev-turn-meta' },
            toolCalls + ' ' + t.turnCalls + (errors ? ' · ' + errors + ' ' + t.turnErrors : ''),
          )
        : null,
      ...nextSteps.map((nextStep) =>
        h(
          'span',
          { className: 'sev-turn-next', key: 'next-' + nextStep.skill },
          t.turnNext + ' ',
          h('b', null, nextStep.skill),
          ' · ' + (t.dims[nextStep.dimension] || nextStep.dimension || 'static') + ' · ' + nextStep.title,
        ),
      ),
      h(
        'details',
        { className: 'sev-turn-detail' },
        h('summary', null, t.turnDetail),
        ...skills.map((skill) => {
          const entry = ((data && data.skills) || []).find((item) => item.skill === skill)
          const advice = ((entry && entry.advice) || []).slice(0, 3)
          const history = ((data && data.edits) || []).filter((edit) => edit.skill === skill).slice(0, 3)
          return h(
            'div',
            { className: 'sev-turn-advice', key: 'advice-' + skill },
            h('b', null, skill),
            advice.length === 0
              ? h('span', null, t.noTurnAdvice)
              : advice.map((raw, index) => {
                  const item = adviceView(raw, lang)
                  return h(
                    'span',
                    { key: item.id || String(index) },
                    (item.severity === 'critical' ? '🛑 ' : item.severity === 'warning' ? '⚠️ ' : 'ℹ️ ') + item.title,
                  )
                }),
            history.length > 0
              ? h(
                  'div',
                  { className: 'sev-turn-history', key: 'history-' + skill },
                  h('span', null, t.turnHistory + ' '),
                  ...history.map((edit, index) =>
                    h(
                      'span',
                      { key: (edit.at || '') + '-' + index },
                      (edit.verdict === 'accept' ? '✅ ' : edit.verdict === 'reject' ? '🚫 ' : '⚠️ ') +
                        (edit.dimension || 'static') +
                        (edit.hypothesis ? ' · ' + edit.hypothesis.slice(0, 60) : ''),
                    ),
                  ),
                )
              : null,
          )
        }),
      ),
    ),
  )
}

const TURN_STYLES = [
  '.sev-turn{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:8px 0 2px;padding:7px 10px;border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:10px;background:var(--dsw-alias-bg-layer-1, #ffffff);font-size:11.5px;color:var(--dsw-alias-label-secondary, #71717a)}',
  '.sev-turn-label{font-weight:600;color:var(--dsw-alias-label-primary, #18181b)}',
  '.sev-turn-chip{display:inline-flex;align-items:center;gap:5px;padding:2px 8px;border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:999px;background:var(--dsw-alias-bg-layer-2, #f4f4f5)}',
  '.sev-turn-chip b{font-weight:600;color:var(--dsw-alias-label-primary, #18181b)}',
  '.sev-turn-chip i{font-style:normal;font-variant-numeric:tabular-nums}',
  '.sev-turn-meta{font-variant-numeric:tabular-nums}',
  '.sev-turn-next{display:inline-flex;align-items:center;gap:4px;padding:2px 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2, #f4f4f5);color:var(--dsw-alias-label-secondary, #52525b);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.sev-turn-next b{font-weight:600;color:var(--dsw-alias-label-primary, #18181b)}',
  '.sev-turn-history{display:flex;flex-direction:column;gap:2px;margin-top:4px;padding-top:4px;border-top:1px dashed var(--dsw-alias-border-l1, #e4e4e7)}',
  '.sev-turn-history span{opacity:.85}',
  '.sev-settings{display:flex;flex-direction:column;gap:14px;padding:4px 0;font-size:12px;max-width:760px}',
  '.sev-settings-group h4{margin:12px 0 2px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary, #71717a)}',
  '.sev-settings-row{display:grid;grid-template-columns:minmax(220px,1fr) auto;align-items:center;gap:14px;padding:9px 0;border-bottom:1px solid var(--dsw-alias-border-l1, #f0f0f2)}',
  '.sev-settings-label{display:flex;flex-direction:column;gap:2px}',
  '.sev-settings-label small{font-size:11px;color:var(--dsw-alias-label-secondary, #71717a)}',
  '.sev-settings-control{display:flex;align-items:center;gap:6px;justify-content:flex-end}',
  '.sev-settings-control em{font-style:normal;font-size:11px;color:var(--dsw-alias-label-secondary, #71717a)}',
  '.sev-settings-row input[type=number]{width:120px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l1, #d4d4d8);border-radius:7px;font:inherit;background:transparent;color:inherit;text-align:right}',
  '.sev-switch{position:relative;display:inline-flex;align-items:center;cursor:pointer}',
  '.sev-switch input{position:absolute;opacity:0;width:1px;height:1px}',
  '.sev-switch i{display:block;width:34px;height:20px;border-radius:999px;background:var(--dsw-alias-border-l2, #d4d4d8);transition:background .15s}',
  '.sev-switch i::after{content:"";display:block;width:16px;height:16px;margin:2px;border-radius:50%;background:#fff;transition:transform .15s}',
  '.sev-switch input:checked + i{background:var(--dsw-alias-brand-primary, #4d6bfe)}',
  '.sev-switch input:checked + i::after{transform:translateX(14px)}',
  '.sev-switch input:focus-visible + i{outline:2px solid var(--dsw-alias-brand-primary, #4d6bfe);outline-offset:2px}',
  '.sev-settings-actions{display:flex;gap:8px}',
  '.sev-settings-status{color:#16a34a;font-size:11.5px}',
  '.sev-settings-status.sev-error{color:#c92a2a}',
  '.sev-settings-heading{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary, #18181b);margin-bottom:2px}',
  '.sev-turn-detail{flex-basis:100%;width:100%;margin:6px 0 0;padding-top:6px;border-top:1px dashed var(--dsw-alias-border-l1, #e4e4e7)}',
  '.sev-turn-detail summary{cursor:pointer;color:var(--dsw-alias-brand-primary, #4d6bfe);font-weight:500}',
  '.sev-turn-detail[open] summary{margin-bottom:4px}',
  '.sev-turn-advice{display:grid;gap:3px;margin:6px 0 0;padding:6px 9px;border-left:2px solid var(--dsw-alias-border-l2, #d4d4d8);border-radius:0 8px 8px 0;background:var(--dsw-alias-bg-layer-2, #f4f4f5)}',
  '.sev-turn-advice + .sev-turn-advice{margin-top:8px}',
  '.sev-turn-advice b{display:block;margin-bottom:2px;color:var(--dsw-alias-label-primary, #18181b)}',
].join('\n')
