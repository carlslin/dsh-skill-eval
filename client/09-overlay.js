function ReportOverlay() {
  const state = useStore()
  const { lang, t } = useLang()
  const [copyState, setCopyState] = useState('idle')
  const copyTimer = useRef(null)
  const mounted = useRef(true)
  const dialogRef = useRef(null)
  const openerRef = useRef(null)

  // Restore keyboard focus to whatever opened the popup, and keep Tab inside
  // the dialog while it is open (it declares aria-modal, so focus must not
  // wander behind the backdrop).
  useEffect(() => {
    if (!state.open) return undefined
    openerRef.current = typeof document !== 'undefined' ? document.activeElement : null
    return () => {
      const opener = openerRef.current
      openerRef.current = null
      if (opener && typeof opener.focus === 'function') {
        try {
          opener.focus()
        } catch {
          // the opener may have unmounted
        }
      }
    }
  }, [state.open])

  const trapTab = (event) => {
    if (event.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const nodes = [
      ...root.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'),
    ].filter((node) => !node.disabled && node.offsetParent !== null)
    if (nodes.length === 0) return
    const first = nodes[0]
    const last = nodes[nodes.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  useEffect(() => {
    if (!state.open) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') closeReport()
    }
    window.addEventListener('keydown', onKey)
    // Keep the numbers moving while a run is in progress. Windows only land
    // at turn end, so a live view shows new loads immediately and their
    // statistics right after the turn settles.
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      load()
    }, REFRESH_MS)
    return () => {
      window.removeEventListener('keydown', onKey)
      clearInterval(timer)
    }
  }, [state.open])

  useEffect(
    () => () => {
      mounted.current = false
      if (copyTimer.current) clearTimeout(copyTimer.current)
    },
    [],
  )

  const copy = async () => {
    const text = buildMarkdown(state.data)
    const ok = await copyText(text)
    if (!mounted.current) return
    setCopyState(ok ? 'copied' : 'failed')
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopyState('idle'), 1500)
  }

  const data = state.data
  const skills = data && Array.isArray(data.skills) ? data.skills : []
  const totals = (data && data.totals) || {}

  return h(
    React.Fragment,
    null,
    h('style', { key: 'sev-style' }, STYLES),
    state.open
      ? h(
          'div',
          {
            className: 'sev-backdrop',
            role: 'presentation',
            onMouseDown: (event) => {
              if (event.target === event.currentTarget) closeReport()
            },
          },
          h(
            'div',
            {
              className: 'sev-dialog',
              role: 'dialog',
              'aria-modal': 'true',
              'aria-label': t.title,
              ref: dialogRef,
              onKeyDown: trapTab,
            },
            h(
              'header',
              { className: 'sev-head' },
              h(
                'div',
                { className: 'sev-head-text' },
                h('div', { className: 'sev-title' }, t.title),
                h('div', { className: 'sev-sub' }, t.subtitle),
                h(
                  'div',
                  { className: 'sev-tabs', role: 'tablist' },
                  ['skills', 'steps', 'runs', 'mcp', 'dev'].map((view) =>
                    h(
                      'button',
                      {
                        key: view,
                        type: 'button',
                        role: 'tab',
                        'aria-selected': state.view === view,
                        className: 'sev-tab' + (state.view === view ? ' sev-tab--on' : ''),
                        onClick: () => setView(view),
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
                  { type: 'button', className: 'sev-btn', onClick: load, disabled: state.loading },
                  t.refresh,
                ),
                h(
                  'button',
                  { type: 'button', className: 'sev-btn', onClick: copy },
                  h(
                    'span',
                    { role: 'status', 'aria-live': 'polite' },
                    copyState === 'copied' ? t.copied : copyState === 'failed' ? t.copyFailed : t.copy,
                  ),
                ),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'sev-btn sev-btn--icon',
                    onClick: closeReport,
                    'aria-label': t.close,
                    title: t.close,
                    autoFocus: true,
                  },
                  '✕',
                ),
              ),
            ),
            h(
              'div',
              { className: 'sev-body' },
              state.loading && !data ? h('div', { className: 'sev-empty' }, t.loading) : null,
              data && !data.scoring
                ? h('div', { className: 'sev-stale' }, h('b', null, t.staleTitle), h('span', null, t.staleHint))
                : null,
              state.error
                ? h('div', { className: 'sev-error' }, t.failed + ': ' + state.error + ' — ' + DATA_URL)
                : null,
              state.view === 'skills'
                ? data && data.ranking
                  ? h(
                      'div',
                      { className: 'sev-note' },
                      lang === 'zh' && data.ranking.noteZh ? data.ranking.noteZh : data.ranking.note,
                    )
                  : null
                : null,
              state.view === 'skills'
                ? !state.loading && !state.error && skills.length === 0
                  ? h('div', { className: 'sev-empty' }, t.empty)
                  : skills.map((skill) =>
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
            h(
              'footer',
              { className: 'sev-foot' },
              h(
                'span',
                null,
                (totals.invocations || 0) + ' ' + t.loads + ' · ' + (totals.skills || 0) + ' ' + t.skillsWord,
              ),
              h(
                'span',
                { className: 'sev-foot-hint' },
                (data && data.scoring
                  ? Object.entries(data.scoring.weightsPercent || {})
                      .map(([key, value]) => key + ' ' + value)
                      .join('/') +
                    ' · A≥' +
                    ((data.scoring.thresholds || {}).excellent ?? 90) +
                    '  —  '
                  : '') +
                  t.footerHint +
                  ' · ' +
                  t.auto,
              ),
              h('span', { className: 'sev-foot-dir' }, (data && data.dataDir) || ''),
            ),
          ),
        )
      : null,
  )
}
