// ------------------------------------------------------------ settings
// Units ship in English from the settings API; the Chinese form localizes them.
const UNIT_ZH = { loads: '次加载', tokens: 'token', edits: '次修改' }
const unitLabel = (unit, lang) => (!unit ? '' : lang === 'zh' ? UNIT_ZH[unit] || unit : unit)

const settingsStore = createStore({ loading: false, saving: false, data: null, error: null, savedAt: 0 })
const useSettings = () => useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get)

async function fetchSettings() {
  settingsStore.set((state) => ({ ...state, loading: true, error: null }))
  let response = await fetch(SETTINGS_URL, { headers: { accept: 'application/json' } })
  if (response.status === 404)
    response = await fetch(SETTINGS_URL_FALLBACK, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error('HTTP ' + response.status)
  const type =
    (response.headers && typeof response.headers.get === 'function' && response.headers.get('content-type')) || ''
  if (type.indexOf('json') === -1) {
    // The dashboard's stale prefix route answers HTML when this host still
    // runs a generation from before the settings API existed.
    throw new Error('host-too-old')
  }
  const data = await response.json()
  settingsStore.set((state) => ({ ...state, loading: false, data }))
  return data
}

async function saveSettings(values) {
  settingsStore.set((state) => ({ ...state, saving: true, error: null }))
  try {
    const post = (url) =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-skill-eval-config': '1' },
        body: JSON.stringify(values),
      })
    let response = await post(SETTINGS_URL)
    if (response.status === 404) response = await post(SETTINGS_URL_FALLBACK)
    const payload = await response.json()
    if (!response.ok || payload.saved !== true) {
      settingsStore.set((state) => ({
        ...state,
        saving: false,
        error: payload.errors?.[0]?.message ?? 'HTTP ' + response.status,
      }))
      return false
    }
    settingsStore.set((state) => ({
      ...state,
      saving: false,
      data: { ...(state.data ?? {}), values: payload.values },
      savedAt: Date.now(),
    }))
    return true
  } catch (error) {
    settingsStore.set((state) => ({
      ...state,
      saving: false,
      error: error instanceof Error ? error.message : String(error),
    }))
    return false
  }
}

function SettingsForm(props) {
  const { lang, t } = useLang()
  // The web config page is a second surface; inside the desktop shell
  // window.open is denied, so the in-panel dialog hides the link it cannot honour.
  const webOpen = !props || props.webOpen !== false
  const state = useSettings()
  const [draft, setDraft] = useState(null)
  useEffect(() => {
    let alive = true
    fetchSettings().catch((error) => {
      if (alive) settingsStore.set((current) => ({ ...current, loading: false, error: error.message }))
    })
    return () => {
      alive = false
    }
  }, [])
  const data = state.data
  const values = draft ?? (data && data.values) ?? {}
  const groups = data && data.fields ? groupSettingsFields(data.fields, lang) : []
  const set = (key, value) => setDraft({ ...values, [key]: value })
  const save = async () => {
    const ok = await saveSettings(values)
    if (ok) setDraft(null)
  }
  if (state.loading && !data) return h('div', { className: 'sev-settings' }, t.settingsLoading)
  if (state.error && !data) {
    const restart = state.error === 'host-too-old'
    return h(
      'div',
      { className: 'sev-settings' },
      h('div', null, restart ? t.settingsNeedsRestart : t.settingsFailed + ': ' + state.error),
      webOpen
        ? h(
            'button',
            {
              type: 'button',
              className: 'sev-btn',
              onClick: () => window.open(window.location.origin + CONFIG_URL, '_blank', 'noopener'),
            },
            t.settingsOpenWeb,
          )
        : null,
    )
  }
  return h(
    'div',
    { className: 'sev-settings' },
    h('style', { key: 'sev-settings-style' }, STYLES + '\n' + TURN_STYLES),
    h('div', { className: 'sev-settings-heading' }, lang === 'zh' ? '评分配置' : 'Scoring settings'),
    h(
      'div',
      { className: 'sev-settings-sub' },
      lang === 'zh'
        ? webOpen
          ? '保存后立即生效；网页配置页提供同一组字段。'
          : '保存后立即生效。'
        : webOpen
          ? 'Saved values apply immediately; the web config page exposes the same fields.'
          : 'Saved values apply immediately.',
    ),
    groups.map((group) =>
      h(
        'div',
        { className: 'sev-settings-group', key: group.title },
        h('h4', null, group.title),
        group.fields.map((field) =>
          h(
            'div',
            { className: 'sev-settings-row', key: field.key },
            h(
              'div',
              { className: 'sev-settings-label' },
              h('span', null, lang === 'zh' ? field.labelZh || field.label : field.label),
              (lang === 'zh' ? field.helpZh : field.help)
                ? h('small', null, lang === 'zh' ? field.helpZh : field.help)
                : null,
            ),
            field.type === 'boolean'
              ? h(
                  'label',
                  { className: 'sev-switch' },
                  h('input', {
                    type: 'checkbox',
                    checked: values[field.key] === true,
                    onChange: (event) => set(field.key, event.currentTarget.checked),
                  }),
                  h('i', { 'aria-hidden': 'true' }),
                )
              : h(
                  'div',
                  { className: 'sev-settings-control' },
                  h('input', {
                    type: 'number',
                    min: field.min,
                    max: field.max,
                    step: field.step,
                    value: values[field.key] ?? '',
                    onChange: (event) => set(field.key, event.currentTarget.value),
                  }),
                  field.unit ? h('em', null, unitLabel(field.unit, lang)) : null,
                ),
          ),
        ),
      ),
    ),
    h(
      'div',
      { className: 'sev-settings-actions' },
      h(
        'button',
        { type: 'button', className: 'sev-btn', disabled: state.saving, onClick: save },
        state.saving ? t.settingsSaving : t.settingsSave,
      ),
      webOpen
        ? h(
            'button',
            {
              type: 'button',
              className: 'sev-btn sev-btn--ghost',
              onClick: () => window.open(window.location.origin + CONFIG_URL, '_blank', 'noopener'),
            },
            t.settingsOpenWeb,
          )
        : null,
    ),
    state.savedAt ? h('div', { className: 'sev-settings-status' }, t.settingsSaved) : null,
    state.error && data ? h('div', { className: 'sev-settings-status sev-error' }, state.error) : null,
  )
}

function groupSettingsFields(fields, lang = 'zh') {
  // The host ships group metadata with every field; the local classifier is
  // only a fallback for an older payload (versioned routes keep old hosts
  // alive after a hot reload).
  const fallbackTitles =
    lang === 'zh'
      ? ['评分权重与阈值', '成本', '建议与生命周期', 'MCP', '输出']
      : ['Scoring', 'Cost', 'Advice & lifecycle', 'MCP', 'Output']
  const fallbackTitle = (field) =>
    field.key.indexOf('weights.') === 0 || field.key.indexOf('thresholds.') === 0
      ? fallbackTitles[0]
      : ['tokenBudgetPerLoad', 'cacheReadWeight', 'countTokens'].includes(field.key)
        ? fallbackTitles[1]
        : ['mcpErrorRatePercent', 'mcpP95Ms'].includes(field.key)
          ? fallbackTitles[3]
          : ['promptHint', 'reportOnTurnEnd'].includes(field.key)
            ? fallbackTitles[4]
            : fallbackTitles[2]
  const groups = new Map()
  for (const field of fields) {
    const title = field.group ? (lang === 'zh' ? field.groupZh || field.group : field.group) : fallbackTitle(field)
    const list = groups.get(title) ?? []
    list.push(field)
    groups.set(title, list)
  }
  return [...groups.entries()].map(([title, list]) => ({ title, fields: list }))
}

/** Native seat: this plugin's row in Settings → Plugins gains a configure page. */
function RowConfig(props) {
  const { t } = useLang()
  const view = props && props.view
  if (view === 'summary') return h('span', null, t.rowConfigSummary)
  return h(SettingsForm, null)
}
