/**
 * GENERATED FILE — do not edit directly.
 * Source: client/*.js · build: node scripts/build-client.mjs
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-eval',
  factory(require) {

    // client/01-runtime.js
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useState, useSyncExternalStore } = React

    const env = { locale: null }

    // ---------------------------------------------------------------- store
    function createStore(initial) {
      let state = initial
      const listeners = new Set()
      return {
        get: () => state,
        set(next) {
          state = typeof next === 'function' ? next(state) : next
          for (const listener of [...listeners]) listener()
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    }

    const store = createStore({ open: false, view: 'skills', loading: false, error: null, data: null, fetchedAt: 0 })
    const useStore = () => useSyncExternalStore(store.subscribe, store.get, store.get)

    // The in-conversation turn card is the product surface; the popup is an
    // optional extra. Set `window.__SEV_ENABLE_POPUP__ = true` in the page (or
    // flip the default here) to bring the sidebar button and modal back.
    const ENABLE_POPUP = typeof window !== 'undefined' && window.__SEV_ENABLE_POPUP__ === true

    // client/02-texts.js
    // --------------------------------------------------------------- locale
    const TEXTS = {
      zh: {
        open: '技能评测',
        title: '技能评测',
        subtitle: '每次 skill 加载之后真实发生了什么：加载成败、后续工具报错、用户有没有推翻、花了多少调用。',
        refresh: '刷新',
        close: '关闭',
        copy: '复制给 agent',
        copied: '已复制',
        copyFailed: '复制失败',
        loading: '正在读取遥测…',
        empty: '还没有记录到技能加载。先用一次 skill 让插件收集数据。',
        failed: '读取失败',
        loads: '加载',
        closed: '已结算',
        corr: '纠正率',
        err: '错误率',
        latency: '加载耗时',
        dims: {
          static: '静态质量',
          reliability: '可靠性',
          effectiveness: '有效性',
          efficiency: '效率',
          lifecycle: '生命周期',
          mcp: 'MCP',
        },
        provisional: '样本不足，分数为临时值',
        noAdvice: '没有需要修的问题',
        footerHint: '也可以直接让 agent 调 skill_eval_report',
        auto: '每 5 秒自动刷新',
        turnLabel: '技能评测',
        kpiSkills: '有遥测的技能',
        kpiLoads: '累计加载',
        kpiFixable: '有待修问题',
        kpiAvg: '平均分',
        searchPlaceholder: '搜索技能…',
        onlyActionable: '仅看待修',
        noMatch: '没有匹配的技能',
        chartScoreDist: '分数分布',
        chartValidity: '证据覆盖',
        chartMcp: 'MCP 延迟',
        chartSessions: '会话活动',
        chartAvg: '均值',
        chartTrend: '趋势',
        chartP50: 'p50',
        chartP95: 'p95',
        chartThreshold: '阈值',
        chartWithCI: '有区间',
        chartProvisional: '临时分',
        chartNoEvidence: '无区间',
        chartActionable: '待修',
        chartLoads: '加载',
        chartCalls: '调用',
        chartErrors: '错误',
        chartSessionsUnit: '次会话',
        noChartData: '暂无数据',
        config: '配置',
        updated: '更新',
        turnCalls: '调用',
        turnErrors: '错误',
        turnNext: '下一步 · 可改',
        tokPerLoad: 'tok/次加载',
        devLoads: '次加载',
        devClosed: '已结算',
        devOpen: '未结算',
        skillsWord: '个技能',
        turnHistory: '改动记录',
        detailSkills: '个技能有遥测',
        detailActionable: '个有待修问题',
        rowConfigSummary: '评分权重、阈值、预算与开关',
        settingsLoading: '正在读取配置…',
        settingsFailed: '读取配置失败',
        settingsSave: '保存',
        settingsSaving: '保存中…',
        settingsSaved: '已保存并立即生效',
        settingsOpenWeb: '在网页里打开',
        settingsNeedsRestart: '当前宿主还是旧版本：重启 DeepSeek Harness 后这里会显示原生设置；也可以先打开网页配置页。',
        storeError: '遥测写入失败',
        turnDetail: '本轮详情',
        noTurnAdvice: '本轮无待修问题',
        tabs: { skills: '按技能', steps: '轨迹', runs: '按运行', mcp: 'MCP', dev: '开发者' },
        stepKpiAvg: '步均分',
        stepKpiLatest: '最近回合',
        stepKpiCount: '已记录步数',
        stepRecent: '近几次回合对比',
        stepFilter: '按技能查看',
        stepAll: '全部',
        stepTurn: '回合',
        stepStep: '步',
        stepCalls: '调用',
        stepErrors: '错误',
        stepDuration: '耗时',
        stepTokens: 'token',
        stepNoData: '还没有逐步遥测：完成一个回合并刷新后自动出现。',
        stepDelta: '较上回合',
        stepFormula: '步分 = 100 − 工具错误×20 − 循环错误×35 − 超量调用×3',
        stepTrace: '查看轨迹',
        stepTurnAvg: '回合均分',
        stepWorst: '最低',
        stepBest: '最高',
        stepFiltered: '只看该技能所在步',
        stepNoSkill: '无技能加载',
        runsHead: ['会话', '评分', '加载', '调用', '报错'],
        mcpHead: ['服务器', '健康', '调用', '错误率', 'p50/p95'],
        emptyRuns: '还没有运行记录',
        emptyMcp: '还没有 MCP 调用记录',
        mcpFailing: '出错的工具',
        mcpFix: 'MCP 修复建议',
        staleTitle: '当前 host 运行的是旧一代插件',
        staleHint:
          '数据里没有 scoring / ranking 字段，说明这个进程还在用升级前的模块。请重启 DeepSeek Harness（退出再打开），然后刷新本页。',
        version: '插件版本',
        devLabels: {
          weights: '评分权重',
          thresholds: '等级线',
          minSamples: '最小样本',
          dataDir: '数据目录',
          api: '数据接口',
          module: '模块 / 磁盘',
          routes: '注册路由',
          tools: '工具',
          skew: '需要重启',
          totals: '记录量',
          store: '存储错误',
          settingsFile: '配置文件',
          warnings: '告警',
          inspect: 'Inspect 提供者',
          ok: '正常',
        },
      },
      en: {
        open: 'Skill eval',
        title: 'Skill eval',
        subtitle:
          'What really happened after each skill load: load success, follow-up tool errors, user pushback, and cost.',
        refresh: 'Refresh',
        close: 'Close',
        copy: 'Copy for agent',
        copied: 'Copied',
        copyFailed: 'Copy failed',
        loading: 'Reading telemetry…',
        empty: 'No skill loads recorded yet. Load one skill to start collecting.',
        failed: 'Read failed',
        loads: 'loads',
        closed: 'closed',
        corr: 'corr',
        err: 'err',
        latency: 'load',
        dims: {
          static: 'static',
          reliability: 'reliability',
          effectiveness: 'effectiveness',
          efficiency: 'efficiency',
          lifecycle: 'lifecycle',
          mcp: 'mcp',
        },
        provisional: 'provisional score: not enough loads yet',
        noAdvice: 'nothing to fix from recorded evidence',
        footerHint: 'The agent can read the same report through skill_eval_report',
        auto: 'auto-refresh every 5s',
        turnLabel: 'Skill eval',
        kpiSkills: 'skills with data',
        kpiLoads: 'loads recorded',
        kpiFixable: 'with a fix',
        kpiAvg: 'average score',
        searchPlaceholder: 'filter skills…',
        onlyActionable: 'needs a fix',
        noMatch: 'no skill matches the filter',
        chartScoreDist: 'Score distribution',
        chartValidity: 'Evidence coverage',
        chartMcp: 'MCP latency',
        chartSessions: 'Session activity',
        chartAvg: 'avg',
        chartTrend: 'trend',
        chartP50: 'p50',
        chartP95: 'p95',
        chartThreshold: 'threshold',
        chartWithCI: 'with CI',
        chartProvisional: 'provisional',
        chartNoEvidence: 'no interval',
        chartActionable: 'to fix',
        chartLoads: 'loads',
        chartCalls: 'calls',
        chartErrors: 'errors',
        chartSessionsUnit: 'session(s)',
        noChartData: 'no data yet',
        config: 'Configure',
        updated: 'updated',
        turnCalls: 'calls',
        turnErrors: 'err',
        turnNext: 'next fix',
        tokPerLoad: 'tok/load',
        devLoads: 'loads',
        devClosed: 'closed',
        devOpen: 'open',
        skillsWord: 'skills',
        turnHistory: 'edit history',
        detailSkills: 'skill(s) with telemetry',
        detailActionable: 'with an actionable fix',
        rowConfigSummary: 'Weights, thresholds, budgets and switches',
        settingsLoading: 'loading settings…',
        settingsFailed: 'failed to load settings',
        settingsSave: 'Save',
        settingsSaving: 'saving…',
        settingsSaved: 'saved and applied',
        settingsOpenWeb: 'Open in browser',
        settingsNeedsRestart:
          'This host still runs an older generation: restart DeepSeek Harness to get the native settings page, or use the web page meanwhile.',
        storeError: 'telemetry write failed',
        turnDetail: 'details',
        noTurnAdvice: 'nothing to fix in this turn',
        tabs: { skills: 'Skills', steps: 'Steps', runs: 'Runs', mcp: 'MCP', dev: 'Dev' },
        stepKpiAvg: 'step average',
        stepKpiLatest: 'latest turn',
        stepKpiCount: 'recorded steps',
        stepRecent: 'Recent turns',
        stepFilter: 'by skill',
        stepAll: 'all',
        stepTurn: 'turn',
        stepStep: 'step',
        stepCalls: 'calls',
        stepErrors: 'errors',
        stepDuration: 'duration',
        stepTokens: 'tokens',
        stepNoData: 'No step telemetry yet: finish a turn and refresh.',
        stepDelta: 'vs previous turn',
        stepFormula: 'step = 100 − tool errors×20 − loop errors×35 − call-volume×3',
        stepTrace: 'view steps',
        stepTurnAvg: 'turn average',
        stepWorst: 'lowest',
        stepBest: 'highest',
        stepFiltered: 'steps that loaded this skill',
        stepNoSkill: 'no skill loaded',
        runsHead: ['session', 'score', 'loads', 'calls', 'errors'],
        mcpHead: ['server', 'health', 'calls', 'errors', 'p50/p95'],
        emptyRuns: 'no runs recorded yet',
        emptyMcp: 'no MCP calls recorded yet',
        mcpFailing: 'failing tools',
        mcpFix: 'MCP fixes',
        staleTitle: 'The running host serves an older plugin generation',
        staleHint:
          'The payload has no scoring/ranking fields, so this process still runs the pre-upgrade module. Quit and reopen DeepSeek Harness, then reload this page.',
        version: 'plugin version',
        devLabels: {
          weights: 'weights',
          thresholds: 'grade bands',
          minSamples: 'min samples',
          dataDir: 'data dir',
          api: 'data api',
          module: 'module / disk',
          routes: 'routes',
          tools: 'tools',
          skew: 'restart',
          totals: 'records',
          store: 'store error',
          settingsFile: 'settings file',
          warnings: 'warnings',
          inspect: 'inspect provider',
          ok: 'ok',
        },
      },
    }

    // Stable identities: a new subscribe function on every render makes
    // useSyncExternalStore resubscribe each time (one pair per card before this).
    const localeSubscribe = (onChange) =>
      env.locale && typeof env.locale.subscribe === 'function' ? env.locale.subscribe(onChange) : () => {}
    const localeSnapshot = () =>
      env.locale && typeof env.locale.getSnapshot === 'function' ? env.locale.getSnapshot() : null
    const localeServerSnapshot = () => null

    function useLang() {
      const snapshot = useSyncExternalStore(localeSubscribe, localeSnapshot, localeServerSnapshot)
      const active = snapshot && snapshot.active ? String(snapshot.active) : 'zh'
      const lang = active.toLowerCase().startsWith('zh') ? 'zh' : 'en'
      return { lang, t: TEXTS[lang] }
    }

    // client/03-data.js
    // ---------------------------------------------------------------- utils
    // Keep in sync with package.json `version` (a test enforces it). The host
    // registers this exact path per release, so a plugin that was hot-reloaded
    // without reclaiming the canonical route still answers here.
    const DATA_VERSION = '1.20.3'
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
      // Colour bands follow the configured grade floors, so a 92-point skill can
      // never render green while its letter says B.
      const thresholds = (store.get().data && store.get().data.scoring && store.get().data.scoring.thresholds) || {}
      const excellent = Number(thresholds.excellent) || 90
      const pass = Number(thresholds.pass) || 70
      if (value >= excellent) return 'var(--dsw-alias-state-success-primary, #2f9e44)'
      if (value >= pass) return 'var(--dsw-alias-state-warn-primary, #d97706)'
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
      const type =
        (response.headers && typeof response.headers.get === 'function' && response.headers.get('content-type')) || ''
      if (type.indexOf('json') === -1) {
        // DSH's prefix route answers 200 HTML for an unclaimed versioned subpath,
        // so a status-only fallback would never fire during a restart-skew.
        const error = new Error(url + ' returned ' + (type || 'no content-type') + ' instead of JSON')
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
      const finish = (patch) => {
        if (generation !== loadGeneration) return
        store.set((state) => ({ ...state, ...patch }))
      }
      store.set((state) => ({ ...state, loading: true, error: null }))
      fetchReport(DATA_URL)
        .catch((error) => {
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

    function pagePath(kind) {
      try {
        const pages = store.get().data && store.get().data.pages
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

    // client/04-components.js
    // ------------------------------------------------------------- components
    function GaugeIcon(props) {
      const size = props?.size || 16
      return h(
        'svg',
        { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', 'aria-hidden': true, style: { display: 'block' } },
        h('path', {
          d: 'M4 17a8 8 0 0 1 16 0',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
        }),
        h('path', { d: 'M12 17l4.5-5.5', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
        h('circle', { cx: 12, cy: 17, r: 1.6, fill: 'currentColor' }),
      )
    }

    // client/05-settings.js
    // ------------------------------------------------------------ settings
    // Units ship in English from the settings API; the Chinese form localizes them.
    const UNIT_ZH = { loads: '次加载', tokens: 'token', edits: '次修改' }
    const unitLabel = (unit, lang) => (!unit ? '' : lang === 'zh' ? UNIT_ZH[unit] || unit : unit)

    const settingsStore = createStore({ loading: false, saving: false, data: null, error: null, savedAt: 0 })
    const useSettings = () => useSyncExternalStore(settingsStore.subscribe, settingsStore.get, settingsStore.get)

    // One generation counter for reads and writes: a slow GET must not overwrite
    // the values a newer save just persisted.
    let settingsGeneration = 0

    async function fetchSettingsPayload(url) {
      const response = await fetch(url, { headers: { accept: 'application/json' } })
      const type =
        (response.headers && typeof response.headers.get === 'function' && response.headers.get('content-type')) || ''
      if (!response.ok || type.indexOf('json') === -1) {
        // DSH's stale prefix route answers 200 HTML for an unclaimed subpath, so
        // treat "not JSON" the same as 404 and try the canonical route.
        const error = new Error(!response.ok ? 'HTTP ' + response.status : 'host-too-old')
        error.status = response.status
        error.notJson = type.indexOf('json') === -1
        throw error
      }
      return response.json()
    }

    async function fetchSettings() {
      const generation = (settingsGeneration += 1)
      const update = (patch) => {
        if (generation === settingsGeneration) settingsStore.set((state) => ({ ...state, ...patch }))
      }
      update({ loading: true, error: null })
      let data
      try {
        data = await fetchSettingsPayload(SETTINGS_URL)
      } catch (error) {
        const retry = error && (error.status === 404 || error.notJson)
        if (!retry) throw error
        try {
          data = await fetchSettingsPayload(SETTINGS_URL_FALLBACK)
        } catch (fallbackError) {
          if (fallbackError && (fallbackError.status === 404 || fallbackError.notJson))
            throw new Error('host-too-old', { cause: fallbackError })
          throw fallbackError
        }
      }
      update({ loading: false, data })
      return data
    }

    async function saveSettings(values) {
      // Invalidate any in-flight GET; its snapshot predates this save.
      settingsGeneration += 1
      settingsStore.set((state) => ({ ...state, saving: true, error: null, savedAt: 0 }))
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
            savedAt: 0,
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
          savedAt: 0,
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
        // A success banner from a previous mount must not reappear on reopen.
        settingsStore.set((current) => (current.savedAt ? { ...current, savedAt: 0 } : current))
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
        const submitted = values
        const ok = await saveSettings(submitted)
        // Keep edits typed while the POST was in flight instead of discarding them.
        if (ok) setDraft((current) => (current === null || current === submitted ? null : current))
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
                  onClick: () => window.open(configUrl(), '_blank', 'noopener'),
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
                        disabled: state.saving,
                        'aria-label': lang === 'zh' ? field.labelZh || field.label : field.label,
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
                        disabled: state.saving,
                        'aria-label': lang === 'zh' ? field.labelZh || field.label : field.label,
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
                  onClick: () => window.open(configUrl(), '_blank', 'noopener'),
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

    // client/06-advice.js
    // Chinese copy for rule-generated advice (host attaches titleZh/fixZh).
    const adviceView = (item, lang) =>
      item && lang === 'zh' && item.titleZh ? { ...item, title: item.titleZh, fix: item.fixZh || item.fix } : item

    // Copy JSON/markdown for the agent. The async Clipboard API needs a real
    // user gesture and can be missing on plain-http hosts, so fall back to the
    // hidden-textarea + execCommand path before reporting failure.
    async function copyText(text) {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text)
          return true
        }
      } catch {
        // fall through to the execCommand path
      }
      try {
        if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
          const area = document.createElement('textarea')
          area.value = text
          area.setAttribute('readonly', '')
          area.style.position = 'fixed'
          area.style.top = '-1000px'
          area.style.opacity = '0'
          document.body.appendChild(area)
          try {
            area.select()
            return Boolean(document.execCommand('copy'))
          } finally {
            area.remove()
          }
        }
      } catch {
        // no clipboard available
      }
      return false
    }

    // client/06b-charts.js
    // Pure-SVG charts for the board panel. No chart library: the bundle stays a
    // single self-contained file, and every chart gets an aria-label with its data.
    const CHART_COLORS = { green: '#2f9e44', yellow: '#d97706', amber: '#c9a227', red: '#c92a2a', blue: '#4d6bfe' }

    function ChartCard(props) {
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

    function chartEmpty(t) {
      return h('div', { className: 'sev-chart-empty' }, t.noChartData)
    }

    function ScoreHistogram(props) {
      const { skills, t } = props
      const values = (skills || []).map((entry) => entry.score?.total).filter((value) => Number.isFinite(value))
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

    function TrendSparkline(props) {
      const { trend, t } = props
      const points = (trend || []).filter((point) => Number.isFinite(point?.total)).slice(-12)
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
        h('circle', { cx: coords.at(-1)[0], cy: coords.at(-1)[1], r: 2.5, fill: color }),
      )
    }

    function ValidityDonut(props) {
      const { validity, t } = props
      const coverage = (validity && validity.coverage) || {}
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

    function fmtMs(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      if (value >= 1000) {
        const seconds = value / 1000
        return (Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)) + 's'
      }
      return Math.round(value) + 'ms'
    }

    function McpLatencyChart(props) {
      const { servers, t, solo } = props
      const rows = (servers || []).filter((row) => (row.calls || 0) > 0).slice(0, 8)
      if (rows.length === 0) return h(ChartCard, { title: t.chartMcp }, chartEmpty(t))
      // The alert line follows the configured MCP p95 threshold; 3000 is only the
      // fallback for an older host payload that predates the `mcp` block.
      const configured = Number(props.thresholdMs)
      const threshold = Number.isFinite(configured) && configured > 0 ? configured : 3000
      const peak = Math.max(threshold, ...rows.map((row) => Math.max(row.p50Ms || 0, row.p95Ms || 0)))
      const scale = peak * 1.05
      const width = (value) => Math.max(1.5, Math.min(100, ((value || 0) / scale) * 100)) + '%'
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

    function SessionActivityChart(props) {
      const { runs, t, solo } = props
      const rows = [...(runs || [])]
        .filter((run) => Number.isFinite(run.lastAt))
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

    function SkillsCharts(props) {
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

    // client/06c-steps.js
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

    // client/07-board.js
    // ------------------------------------------------------------- main panel
    // Same placement as the context plugin: a sidebar panel icon + a main panel
    // keyed by the same id. This is the board's primary home inside DSH.
    function PanelIcon(props) {
      const size = props && Number(props.size) > 0 ? Number(props.size) : 18
      const active = props && props.active === true
      return h('span', { style: { display: 'inline-flex', opacity: active ? 1 : 0.72 } }, h(GaugeIcon, { size }))
    }

    function BoardPanel() {
      const state = useStore()
      const { lang, t } = useLang()
      const copyTimer = useRef(null)
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
        const onKey = (event) => {
          if (event.key === 'Escape') setConfigOpen(false)
        }
        window.addEventListener('keydown', onKey)
        return () => {
          window.removeEventListener('keydown', onKey)
          if (opener && typeof opener.focus === 'function') opener.focus()
        }
      }, [configOpen])
      const data = state.data
      const skills = (data && data.skills) || []
      const [copyState, setCopyState] = useState('idle')
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
      const trapFocus = (event) => {
        if (event.key !== 'Tab') return
        const focusable = [
          ...event.currentTarget.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'),
        ].filter((node) => !node.disabled && node.offsetParent !== null)
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
      const hasFix = (entry) =>
        (entry.advice || []).some((item) => item.severity === 'critical' || item.severity === 'warning')
      const fixable = skills.filter(hasFix).length
      const loads = skills.reduce((total, entry) => total + (entry.stats?.loads || 0), 0)
      const scored = skills.map((entry) => entry.score?.total).filter((value) => Number.isFinite(value))
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
              ['skills', 'steps', 'runs', 'mcp', 'dev'].map((view) =>
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
                    onKeyDown: (event) => {
                      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
                      event.preventDefault()
                      const views = ['skills', 'steps', 'runs', 'mcp', 'dev']
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
                onMouseDown: (event) => {
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

    function FooterAction(props) {
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

    function DimensionBar(props) {
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

    const SkillCard = React.memo(function SkillCard(props) {
      const skill = props.skill
      const t = props.t
      const lang = props.lang || 'zh'
      const score = skill.score || {}
      const dims = score.dimensions || {}
      const stats = skill.stats || {}
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
          h(
            'button',
            {
              type: 'button',
              className: 'sev-trace',
              title: t.stepTrace,
              'aria-label': t.stepTrace + ': ' + skill.skill,
              onClick: () => props.onTrace && props.onTrace(skill.skill),
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
                )
              }),
            )
          : h('div', { className: 'sev-meta' }, t.noAdvice),
      )
    })

    function DataTable(props) {
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

    function RunsView(props) {
      const t = props.t
      const runs = props.data && Array.isArray(props.data.runs) ? props.data.runs : []
      return h(
        React.Fragment,
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

    function McpView(props) {
      const t = props.t
      const lang = props.lang || 'zh'
      const data = props.data || {}
      const servers = Array.isArray(data.mcpServers) ? data.mcpServers : []
      const advice = (Array.isArray(data.mcpAdvice) ? data.mcpAdvice : []).slice(0, 6)
      const failing = []
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
      const latency = (row) =>
        row.p50Ms === null || row.p50Ms === undefined
          ? '—'
          : fmtMs(row.p50Ms) + ' / ' + (row.p95Ms === null || row.p95Ms === undefined ? '—' : fmtMs(row.p95Ms))
      return h(
        React.Fragment,
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

    function DevView(props) {
      const t = props.t
      const data = props.data || {}
      const scoring = data.scoring || {}
      const totals = data.totals || {}
      const weights = scoring.weightsPercent || {}
      const th = scoring.thresholds || {}
      const dev = data.dev || {}
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

    // client/08-turn.js
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

      const retryRef = useRef({ key: '', count: 0 })
      useEffect(() => {
        ensureReport()
      }, [sessionId, turn && turn.turn])
      // ensureReport() has a 10 s warm-cache window; a turn that settles inside it
      // has no turnLoads row yet and would render nothing forever. Retry twice.
      useEffect(() => {
        const turnNumber =
          typeof turn?.turn === 'number' ? turn.turn : typeof turn?.number === 'number' ? turn.number : null
        if (turnNumber === null) return undefined
        const data = state.data
        if (!data || !Array.isArray(data.turnLoads)) return undefined
        if (data.turnLoads.some((row) => row.sessionId === sessionId && row.turn === turnNumber)) return undefined
        const key = sessionId + ':' + turnNumber
        if (retryRef.current.key !== key) retryRef.current = { key, count: 0 }
        if (retryRef.current.count >= 2) return undefined
        retryRef.current.count += 1
        const timer = setTimeout(() => load(), 1200)
        return () => clearTimeout(timer)
      }, [sessionId, turn, state.data, state.fetchedAt])

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
        // DSH's tool-call node payload is ToolChatData { root: ToolCallBlock }; the
        // error flag lives on the settled root block, not on data.isError.
        errors = inTurn.filter((node) => node?.kind === 'tool-call' && node.data?.root?.isError === true).length
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
                            (edit.hypothesis ? ' · ' + String(edit.hypothesis).slice(0, 60) : ''),
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

    // client/09-overlay.js
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
                            id: 'sev-overlay-tab-' + view,
                            'aria-controls': 'sev-overlay-view',
                            'aria-selected': state.view === view,
                            tabIndex: state.view === view ? 0 : -1,
                            className: 'sev-tab' + (state.view === view ? ' sev-tab--on' : ''),
                            onClick: () => setView(view),
                            onKeyDown: (event) => {
                              if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
                              event.preventDefault()
                              const views = ['skills', 'steps', 'runs', 'mcp', 'dev']
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

    // client/10-styles.js
    const STYLES = [
      '.sev-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:9px;background:var(--dsw-alias-bg-layer-1, #ffffff);color:var(--dsw-alias-label-secondary, #71717a);font-size:12px;line-height:1;cursor:pointer;white-space:nowrap;font-family:inherit}',
      '.sev-btn:hover{color:var(--dsw-alias-label-primary, #18181b);border-color:var(--dsw-alias-border-l2, #d4d4d8)}',
      '.sev-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary, #4d6bfe);outline-offset:1px}',
      '.sev-btn--icon{width:30px;padding:0}',
      '.sev-btn--ghost{background:transparent}',
      '.sev-backdrop{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:28px;background:rgba(9,9,11,.44);pointer-events:auto}',
      '.sev-dialog{display:flex;flex-direction:column;width:min(780px,94vw);max-height:84vh;overflow:hidden;border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:16px;background:var(--dsw-alias-bg-overlay, #ffffff);color:var(--dsw-alias-label-primary, #18181b);box-shadow:0 26px 70px rgba(0,0,0,.34);font-size:13px;line-height:1.5}',
      '.sev-head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 12px;border-bottom:1px solid var(--dsw-alias-border-l1, #e4e4e7)}',
      '.sev-head-text{flex:1;min-width:0}',
      '.sev-title{font-size:15px;font-weight:600}',
      '.sev-sub{margin-top:3px;color:var(--dsw-alias-label-secondary, #71717a);font-size:11.5px;line-height:1.45}',
      '.sev-head-actions{display:flex;gap:6px;flex:none}',
      '.sev-body{flex:1;overflow:auto;padding:14px 18px 18px;display:flex;flex-direction:column;gap:12px}',
      '.sev-empty{padding:26px 0;text-align:center;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-error{margin:0;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-primary, #c92a2a);color:var(--dsw-alias-state-error-primary, #c92a2a);font-size:12px;word-break:break-all}',
      '.sev-card{border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:12px;background:var(--dsw-alias-bg-layer-1, #ffffff);padding:12px 14px}',
      '.sev-card-head{display:flex;align-items:baseline;gap:10px}',
      '.sev-name{flex:1;font-weight:600;font-size:13.5px;word-break:break-word}',
      '.sev-grade{font-weight:700;font-size:17px;font-variant-numeric:tabular-nums}',
      '.sev-total{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.sev-provisional{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-ci{margin-top:2px;font-size:11px;color:var(--dsw-alias-label-secondary, #71717a);font-variant-numeric:tabular-nums}',
      '.sev-note{margin-bottom:10px;padding:8px 10px;border-radius:9px;border:1px solid var(--dsw-alias-state-warn-primary, #d97706);color:var(--dsw-alias-label-primary, #18181b);font-size:11.5px;line-height:1.45}',
      '.sev-stale{display:grid;gap:3px;margin-bottom:10px;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-primary, #c92a2a);background:var(--dsw-alias-bg-layer-1, #ffffff);font-size:11.5px;line-height:1.5}',
      '.sev-stale b{color:var(--dsw-alias-state-error-primary, #c92a2a);font-size:12px}',
      '.sev-stale span{color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-dims{display:grid;gap:4px;margin:9px 0 8px}',
      '.sev-dim{display:grid;grid-template-columns:96px 1fr 40px;align-items:center;gap:8px}',
      '.sev-dim-label{font-size:11px;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-dim-track{display:block;height:6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2, #f4f4f5);overflow:hidden}',
      '.sev-dim-track i{display:block;height:100%;border-radius:4px;min-width:2px}',
      '.sev-dim b{font-size:11px;font-weight:600;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-meta{font-size:11px;color:var(--dsw-alias-label-secondary, #71717a);font-variant-numeric:tabular-nums}',
      '.sev-advice{list-style:none;margin:9px 0 0;padding:0;display:grid;gap:7px}',
      '.sev-advice li{border-left:3px solid var(--dsw-alias-border-l2, #d4d4d8);padding-left:9px}',
      '.sev-advice b{display:block;font-size:12px;font-weight:600}',
      '.sev-advice span{display:block;font-size:11px;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-advice em{display:block;margin-top:2px;font-size:11px;font-style:normal;color:var(--dsw-alias-label-primary, #18181b);opacity:.86}',
      '.sev-tabs{display:flex;gap:4px;margin-top:8px}',
      '.sev-tab{border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary, #71717a);font-size:12px;padding:3px 9px;border-radius:7px;cursor:pointer;font-family:inherit}',
      '.sev-tab:hover{color:var(--dsw-alias-label-primary, #18181b);background:var(--dsw-alias-bg-layer-2, #f4f4f5)}',
      '.sev-tab--on{color:var(--dsw-alias-label-primary, #18181b);background:var(--dsw-alias-bg-layer-2, #f4f4f5);font-weight:600}',
      '.sev-table{display:grid;gap:2px;font-size:12px}',
      '.sev-kv{display:grid;gap:6px;font-size:12px}',
      // NOTE: '.sev-sub' belongs to the panel subtitle; the advice container used to
      // reuse that class and silently restyled the header. It is now its own class.
      '.sev-advice-list{display:grid;gap:4px;margin-top:8px;font-size:12px}',
      '.sev-sub-row{display:flex;justify-content:space-between;gap:10px;padding:4px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2, #f4f4f5)}',
      '.sev-sub-row b{font-variant-numeric:tabular-nums;color:var(--dsw-alias-state-error-primary, #c92a2a)}',
      '.sev-advice-row{display:grid;gap:2px;padding:6px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-2, #f4f4f5)}',
      '.sev-card{border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:12px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1, #fff);min-width:0}',
      '.sev-card-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:4px;font-size:12px}',
      '.sev-card-head b{font-weight:600}',
      '.sev-card-head span{color:var(--dsw-alias-label-secondary, #71717a);font-size:10.5px;font-variant-numeric:tabular-nums}',
      '.sev-table--mcp .sev-tr{grid-template-columns:1.5fr .8fr .5fr .6fr 1fr}',
      '.sev-health{display:inline-flex;align-items:center;gap:5px;font-variant-numeric:tabular-nums}',
      '.sev-grade{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 4px;border-radius:5px;font-style:normal;font-size:10px;font-weight:700;background:var(--dsw-alias-bg-layer-2, #f4f4f5)}',
      '.sev-lat{display:grid;gap:10px;padding:4px 0 2px}',
      '.sev-lat-row{display:grid;gap:4px}',
      '.sev-lat-head{display:flex;justify-content:space-between;gap:10px;font-size:11.5px}',
      '.sev-lat-head b{font-weight:600}',
      '.sev-lat-head span{color:var(--dsw-alias-label-secondary, #71717a);font-variant-numeric:tabular-nums}',
      '.sev-meter{position:relative;height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2, #f4f4f5)}',
      '.sev-meter-fill{position:absolute;left:0;top:0;height:100%;border-radius:999px}',
      '.sev-meter-fill--p95{background:var(--dsw-alias-state-warn-primary, #d97706);opacity:.35}',
      '.sev-meter-fill--p50{background:var(--dsw-alias-brand-primary, #4d6bfe)}',
      '.sev-meter-threshold{position:absolute;top:-4px;bottom:-4px;width:0;border-left:1px dashed var(--dsw-alias-state-error-primary, #c92a2a);opacity:.75}',
      '.sev-advice-row b{font-size:12px;font-weight:600}',
      '.sev-advice-row em{font-style:normal;font-size:11px;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-kv-row{display:grid;grid-template-columns:120px 1fr;gap:10px;padding:5px 8px;border-radius:7px;background:var(--dsw-alias-bg-layer-1, #ffffff)}',
      '.sev-kv-row span{color:var(--dsw-alias-label-secondary, #71717a);font-size:11px}',
      '.sev-kv-row b{font-weight:500;word-break:break-all;font-variant-numeric:tabular-nums}',
      '.sev-tr{display:grid;grid-template-columns:1.4fr .6fr .6fr .6fr .6fr;gap:8px;padding:6px 8px;border-radius:7px}',
      '.sev-tr:nth-child(odd){background:var(--dsw-alias-bg-layer-1, #ffffff)}',
      '.sev-th{color:var(--dsw-alias-label-secondary, #71717a);font-size:11px;text-transform:none}',
      '.sev-tr span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.sev-strong{font-weight:600}',
      '.sev-foot{display:flex;align-items:center;gap:10px;padding:9px 18px;border-top:1px solid var(--dsw-alias-border-l1, #e4e4e7);font-size:11px;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-foot-hint{flex:1;text-align:center}',
      '.sev-foot-dir{max-width:36%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl}',
      '.sev-trace{padding:2px 7px;border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary, #71717a);font:inherit;font-size:10.5px;cursor:pointer;white-space:nowrap}',
      '.sev-trace:hover{color:var(--dsw-alias-brand-primary, #4d6bfe);border-color:var(--dsw-alias-brand-primary, #4d6bfe)}',
      '.sev-steps{display:flex;flex-direction:column;gap:12px}',
      '.sev-steps-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}',
      '.sev-recent{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:8px 12px;border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:10px;font-size:11px}',
      '.sev-recent b{font-weight:600}',
      '.sev-recent-turn{display:flex;flex-direction:column;gap:3px;min-width:92px;font-size:10px;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-recent-turn i{display:block;height:5px;border-radius:3px;background:var(--dsw-alias-brand-primary, #4d6bfe)}',
      '.sev-recent-turn em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary, #18181b)}',
      '.sev-step-filters{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:11px}',
      '.sev-step-formula{font-size:10.5px;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-turn{border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1, #fff)}',
      '.sev-turn-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l1, #e4e4e7);font-size:11.5px;background:var(--dsw-alias-bg-layer-2, #f4f4f5)}',
      '.sev-turn-meta{flex:1;min-width:120px;font-size:10.5px;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-turn-avg{font-weight:600;font-variant-numeric:tabular-nums}',
      '.sev-turn-delta,.sev-step-delta{font-size:10.5px;font-variant-numeric:tabular-nums}',
      '.sev-step-delta--up{color:#2f9e44}',
      '.sev-step-delta--down{color:#c92a2a}',
      '.sev-step-delta--flat{color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-steplist{list-style:none;margin:0;padding:2px 0;display:grid}',
      '.sev-step{display:flex;align-items:center;gap:10px;padding:5px 12px}',
      '.sev-step:nth-child(odd){background:color-mix(in srgb, var(--dsw-alias-bg-layer-2, #f4f4f5) 55%, transparent)}',
      '.sev-step-score{flex:none;width:44px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:1px solid;border-radius:7px;font-weight:700;font-size:12px;font-variant-numeric:tabular-nums}',
      '.sev-step-main{flex:1;min-width:0}',
      '.sev-step-title{display:flex;align-items:center;gap:8px;font-size:11.5px;flex-wrap:wrap}',
      '.sev-step-sub{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:1px;font-size:10px;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-step-skill{padding:0 6px;border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:9.5px;cursor:pointer}',
      '.sev-step-skill:hover{color:var(--dsw-alias-brand-primary, #4d6bfe);border-color:var(--dsw-alias-brand-primary, #4d6bfe)}',
      '.sev-step-err{color:#c92a2a}',
      '.sev-muted{color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}',
      '.sev-chart{border:1px solid var(--dsw-alias-border-l1, #e4e4e7);border-radius:12px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1, #fff);min-width:0}',
      '.sev-chart-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:12px}',
      '.sev-chart-head b{font-weight:600}',
      '.sev-chart-head span{color:var(--dsw-alias-label-secondary, #71717a);font-size:10.5px;font-variant-numeric:tabular-nums}',
      '.sev-chart-svg{display:block;width:100%;height:auto;color:var(--dsw-alias-label-secondary, #71717a);overflow:visible}',
      '.sev-chart-empty{padding:22px 0;text-align:center;color:var(--dsw-alias-label-secondary, #71717a);font-size:11px}',
      '.sev-chart--solo{max-width:560px}',
      '.sev-chart-legend{list-style:none;margin:0;padding:0;display:grid;gap:3px;font-size:10.5px;color:var(--dsw-alias-label-secondary, #71717a)}',
      '.sev-chart-legend li{display:flex;align-items:center;gap:5px}',
      '.sev-chart-legend i{width:8px;height:8px;border-radius:2px;display:inline-block;flex:none}',
      '.sev-chart-legend b{color:var(--dsw-alias-label-primary, #18181b);font-variant-numeric:tabular-nums}',
      '.sev-donut-wrap{display:flex;align-items:center;gap:12px}',
      '.sev-donut{width:84px;height:84px;flex:none}',
      '.sev-spark{width:64px;height:18px;flex:none;opacity:0.9}',
      '@media(max-width:720px){.sev-charts{grid-template-columns:1fr}}',
    ].join('\n')

    // client/11-apply.js
    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        env.locale = ctx.locale
        ctx.slots.inject('conversation.chat.turnTail', () =>
          ctx.slots.register({ name: 'conversation.chat.turnTail', id: 'skill-eval-turn', order: 30 }, TurnSkillCard),
        )
        // Board: sidebar panel icon + the main panel it addresses (same pattern
        // as the context plugin). The icon label follows the page language.
        const panelLabel = () => {
          let active
          try {
            const snapshot = ctx.locale && typeof ctx.locale.getSnapshot === 'function' ? ctx.locale.getSnapshot() : null
            active = snapshot && snapshot.active ? String(snapshot.active) : ''
          } catch {
            // fall back to the browser language below
          }
          if (!active && typeof navigator !== 'undefined') active = String(navigator.language || '')
          return /^zh/i.test(active) ? '技能评测' : 'Skill eval'
        }
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id: 'skill-eval', order: 40, label: panelLabel }, PanelIcon),
        )
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'skill-eval' }, BoardPanel))
        // Two human entry points by design: the in-conversation strip (below)
        // and one board row in the session header's More menu. Settings live in
        // the plugin's own row config page, not a separate section.
        if (ENABLE_POPUP) {
          ctx.slots.inject('sidebar.footer.action', () =>
            ctx.slots.register(
              { name: 'sidebar.footer.action', id: 'skill-eval-open', order: 30, label: panelLabel },
              FooterAction,
            ),
          )
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'skill-eval-modal', order: 900 }, ReportOverlay),
          )
        }
        // Settings: the bundle's own config page (Settings → Plugins → this
        // bundle), keyed by the package name — the same seat the context plugin
        // uses for its settings.
        ctx.slots.inject('plugins.bundle.config', () =>
          ctx.slots.register({ name: 'plugins.bundle.config', key: 'dsh-skill-eval' }, RowConfig),
        )
      },
    }
  },
})
