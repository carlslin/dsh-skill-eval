function ReportOverlay() {
  const state = useStore()
  const { lang, t } = useLang()
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const openerRef = useRef<Element | null>(null)

  // Restore keyboard focus to whatever opened the popup, and keep Tab inside
  // the dialog while it is open (it declares aria-modal, so focus must not
  // wander behind the backdrop).
  useEffect(() => {
    if (!state.open) return undefined
    openerRef.current = typeof document !== 'undefined' ? document.activeElement : null
    return () => {
      const opener = openerRef.current
      openerRef.current = null
      if (opener && typeof (opener as HTMLElement).focus === 'function') {
        try {
          ;(opener as HTMLElement).focus()
        } catch {
          // the opener may have unmounted
        }
      }
    }
  }, [state.open])

  const trapTab = (event: import('react').KeyboardEvent) => {
    if (event.key !== 'Tab') return
    const root = dialogRef.current
    if (!root) return
    const nodes = [
      ...root.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'),
    ].filter((node) => !(node as HTMLButtonElement).disabled && node.offsetParent !== null)
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
    const onKey = (event: KeyboardEvent) => {
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
    Fragment,
    null,
    h('style', { key: 'sev-style' }, STYLES),
    state.open
      ? h(
          'div',
          {
            className: 'sev-backdrop',
            role: 'presentation',
            onMouseDown: (event: import('react').MouseEvent) => {
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
                  (['skills', 'steps', 'runs', 'mcp', 'dev'] as ReportView[]).map((view) =>
                    h(
                      'button',
                      {
                        key: view,
                        type: 'button',
                        role: 'tab',
                        id: 'sev-overlay-tab-' + view,
                        'aria-controls': 'sev-overlay-view',
                        'aria-selected': state.view === view,
                        tabIndex: state.view === view ? 0 : -1,
                        className: 'sev-tab' + (state.view === view ? ' sev-tab--on' : ''),
                        onClick: () => setView(view),
                        onKeyDown: (event: import('react').KeyboardEvent) => {
                          if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
                          event.preventDefault()
                          const views: ReportView[] = ['skills', 'steps', 'runs', 'mcp', 'dev']
                          const index = views.indexOf(view)
                          const next =
                            views[(index + (event.key === 'ArrowRight' ? 1 : views.length - 1)) % views.length]
                          setView(next)
                          const target =
                            typeof document !== 'undefined' ? document.getElementById('sev-overlay-tab-' + next) : null
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
              {
                className: 'sev-body',
                role: 'tabpanel',
                id: 'sev-overlay-view',
                'aria-labelledby': 'sev-overlay-tab-' + state.view,
              },
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
