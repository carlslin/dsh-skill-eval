import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after } from 'node:test'
import { JSDOM } from 'jsdom'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { createHost } from './helpers.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = path.join(HERE, '..', 'client.js')

/** Every timer created through the harness, cleared after each test. */
const liveTimers = new Set()
after(() => {
  for (const id of liveTimers) {
    clearInterval(id)
    clearTimeout(id)
  }
  liveTimers.clear()
})

/** Fake timers that compress long delays so polling is testable. */
const fastTimeout = (fn, delay, ...rest) => {
  const id = setTimeout(fn, Math.min(delay || 0, 5), ...rest)
  liveTimers.add(id)
  setTimeout(() => liveTimers.delete(id), 1000).unref?.()
  return id
}
const fastInterval = (fn, delay, ...rest) => {
  const id = setInterval(fn, Math.min(delay || 0, 10), ...rest)
  liveTimers.add(id)
  return id
}

/** Poll a predicate so timing-sensitive assertions survive a busy event loop. */
async function waitFor(predicate, timeoutMs = 1500) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  return predicate()
}

const SETTINGS_FIXTURE = {
  fields: [
    { key: 'weights.static', label: 'weight: static', type: 'number', min: 0, max: 1, step: 0.05, value: 0.3 },
    { key: 'minSamples', label: 'min samples for an interval', type: 'number', min: 1, max: 100, step: 1, value: 3 },
    { key: 'adviceNoiseFloor', label: 'advice noise floor', type: 'boolean', value: true },
  ],
  values: { 'weights.static': 0.3, minSamples: 3, adviceNoiseFloor: true },
}

const REPORT = {
  generatedAt: '2026-11-14T10:00:00.000Z',
  dataDir: '/Users/adams/.dsh/skill-eval/default',
  totals: { invocations: 3, skills: 1, closed: 2, open: 1, storeError: null },
  ranking: {
    significant: false,
    ties: [{ a: 'pdf-tools', b: 'caveman-help', aTotal: 89.5, bTotal: 85 }],
    note: 'rank is not significant: "pdf-tools" (89.5) and "caveman-help" (85) have overlapping 95% intervals — treat them as a tie',
  },
  scoring: {
    weights: { static: 0.3, reliability: 0.25, effectiveness: 0.3, efficiency: 0.15 },
    weightsPercent: { static: 30, reliability: 25, effectiveness: 30, efficiency: 15 },
    thresholds: { excellent: 90, good: 80, pass: 70 },
    minSamples: 3,
    customizable: true,
  },
  edits: [
    { skill: 'pdf-tools', verdict: 'accept', dimension: 'static', hypothesis: 'sharpen triggers', at: 3e12 },
    { skill: 'pdf-tools', verdict: 'reject', dimension: 'static', hypothesis: 'hardcode answer', at: 3e12 - 1 },
  ],
  mcpAdvice: [
    {
      id: 'mcp-server-errors',
      severity: 'critical',
      server: 'context7',
      title: 'MCP server "context7" fails 21% of its calls',
      evidence: '3/14 calls failed',
      fix: 'Check the server process.',
    },
  ],
  mcp: { p95Ms: 3000, errorRatePercent: 20 },
  dev: { moduleVersion: '1.20.1', diskVersion: '1.20.1', skew: false, routes: 12, tools: 3, warnings: 0 },
  turnLoads: [{ sessionId: 'session-abc', turn: 2, skills: ['pdf-tools', 'caveman-help'], firstAt: 1, lastAt: 2 }],
  steps: [
    {
      at: 100,
      sessionId: 's',
      turn: 1,
      step: 1,
      durationMs: 1200,
      toolCalls: 2,
      errors: 0,
      skills: ['pdf-tools'],
      score: { total: 100, grade: 'A', penalties: [] },
      tokens: { input: 100, output: 20, cacheRead: 0, calls: 1 },
    },
    {
      at: 200,
      sessionId: 's',
      turn: 1,
      step: 2,
      durationMs: 800,
      toolCalls: 3,
      errors: 1,
      skills: [],
      score: { total: 80, grade: 'B', penalties: [{ id: 'tool-errors', penalty: 20 }] },
      tokens: { input: 80, output: 10, cacheRead: 0, calls: 1 },
    },
    {
      at: 300,
      sessionId: 's',
      turn: 2,
      step: 1,
      durationMs: 600,
      toolCalls: 1,
      errors: 0,
      skills: [],
      score: { total: 60, grade: 'D', penalties: [] },
      tokens: { input: 50, output: 5, cacheRead: 0, calls: 1 },
    },
  ],
  stepTurns: [
    {
      sessionId: 's',
      turn: 2,
      lastAt: 300,
      steps: [{ at: 300, sessionId: 's', turn: 2, step: 1, score: { total: 60 } }],
      skills: [],
      average: 60,
      best: 60,
      worst: 60,
    },
    {
      sessionId: 's',
      turn: 1,
      lastAt: 200,
      steps: [
        { at: 100, sessionId: 's', turn: 1, step: 1, score: { total: 100 } },
        { at: 200, sessionId: 's', turn: 1, step: 2, score: { total: 80 } },
      ],
      skills: ['pdf-tools'],
      average: 90,
      best: 100,
      worst: 80,
    },
  ],
  stepOverall: { steps: 3, turns: 2, average: 80, latestAverage: 60, previousAverage: 90, delta: -30 },
  validity: {
    coverage: { skills: 2, withCI: 1, provisional: 1, actionable: 1 },
    ranking: { significant: false },
    canSay: ['scores for 2 skill(s)'],
    cannotSay: ['1 skill has no interval yet'],
  },
  mcpServers: [
    {
      server: 'context7',
      calls: 4,
      errors: 2,
      errorRate: 0.5,
      avgMs: 210,
      p50Ms: 180,
      p95Ms: 420,
      samples: 4,
      health: 65,
      grade: 'D',
      tools: [{ tool: 'query-docs', calls: 3, errors: 2, errorRate: 2 / 3 }],
    },
  ],
  runs: [
    {
      sessionId: 'session-abcdef123456',
      lastAt: 3e12,
      loads: 2,
      toolCalls: 7,
      errors: 1,
      corrections: 1,
      mcpCalls: 4,
      mcpErrors: 2,
      skills: ['pdf-tools'],
      score: {
        total: 62.5,
        grade: 'D',
        confidence: 'low',
        ci: { low: 41.2, high: 88.3, resamples: 200 },
        dimensions: { quality: 88, stability: 40, outcome: 55, efficiency: 100 },
      },
    },
  ],
  skills: [
    {
      skill: 'pdf-tools',
      source: 'user-agents',
      stats: {
        loads: 3,
        closed: 2,
        open: 1,
        loadOkRate: 1,
        errRate: 0.2,
        correctionRate: 0.5,
        abandonRate: 0,
        siblingRate: 0,
        avgCalls: 4,
        p50LoadMs: 940,
      },
      staticQuality: { score: 77 },
      score: {
        total: 89.5,
        grade: 'B',
        provisional: false,
        samples: 3,
        ci: { level: 0.95, low: 78.2, high: 96.4, resamples: 200 },
        dimensions: { static: 77, reliability: 100, effectiveness: 62.5, efficiency: 88 },
      },
      trend: [
        { at: 1, total: 80 },
        { at: 2, total: 85 },
        { at: 3, total: 89.5 },
      ],
      advice: [
        {
          id: 'user-corrections',
          severity: 'critical',
          dimension: 'effectiveness',
          title: 'The user rejects the result right after the skill runs',
          evidence: '50% of runs were followed by a correcting message',
          fix: 'Tighten the output contract and add a self-check before answering.',
        },
      ],
      topAdvice: [
        {
          id: 'user-corrections',
          severity: 'critical',
          dimension: 'effectiveness',
          title: 'The user rejects the result right after the skill runs',
          evidence: '50% of runs were followed by a correcting message',
          fix: 'Tighten the output contract and add a self-check before answering.',
        },
      ],
    },
    {
      skill: 'caveman-help',
      source: 'custom',
      stats: {
        loads: 1,
        closed: 1,
        open: 0,
        loadOkRate: 1,
        errRate: 0,
        correctionRate: 0,
        abandonRate: 0,
        siblingRate: 0,
        avgCalls: 1,
        p50LoadMs: 320,
      },
      staticQuality: { score: 70 },
      score: {
        total: 85,
        grade: 'B',
        provisional: true,
        samples: 1,
        ci: null,
        dimensions: { static: 70, reliability: 100, effectiveness: 80, efficiency: 100 },
      },
      advice: [
        {
          id: 'static-no-trigger',
          severity: 'warning',
          dimension: 'static',
          title: 'The description does not say when to use this skill',
          evidence: 'no trigger sentence in the description',
          fix: 'Add a "Use when …" sentence with concrete trigger words.',
        },
      ],
    },
  ],
}

async function mountClient(options = {}, overrides = {}) {
  options = { ...options, ...overrides }
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:50403/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  globalThis.window = window
  globalThis.document = window.document
  globalThis.HTMLElement = window.HTMLElement
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  const fetched = []
  globalThis.fetch = async (url) => {
    const target = String(url)
    fetched.push(target)
    if (options.failFetch) throw new Error('boom')
    if (options.versionedMissing && !target.endsWith('/data')) {
      return {
        ok: false,
        status: 404,
        async json() {
          return null
        },
      }
    }
    if (target.includes('/settings')) {
      if (options.settingsHtml) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'text/html; charset=utf-8' },
          async json() {
            return null
          },
        }
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        async json() {
          return options.settings ?? SETTINGS_FIXTURE
        },
      }
    }
    const body = options.report ?? REPORT
    return {
      ok: true,
      status: 200,
      async json() {
        return body
      },
    }
  }

  let descriptor = null
  window.__SEV_ENABLE_POPUP__ = options.popup === true
  window.__ModuleLoader__ = {
    load(definition) {
      descriptor = definition
    },
  }

  const source = await readFile(CLIENT_FILE, 'utf8')
  const run = new Function(
    'window',
    'fetch',
    'navigator',
    'document',
    'setTimeout',
    'clearTimeout',
    'setInterval',
    'clearInterval',
    `${source}`,
  )
  run(
    window,
    globalThis.fetch,
    window.navigator,
    window.document,
    fastTimeout,
    clearTimeout,
    fastInterval,
    clearInterval,
  )

  assert.ok(descriptor, 'client descriptor was not registered on window.__ModuleLoader__')
  assert.equal(descriptor.id, 'dsh-skill-eval')

  const registrations = []
  const React = (await import('react')).default
  const moduleExports = { require: (name) => (name === 'react' ? React : undefined) }
  const plugin = descriptor.factory(moduleExports.require)
  plugin.apply({
    slots: {
      inject(_owner, callback) {
        callback()
      },
      register(registration, Component) {
        registrations.push({ registration, Component })
      },
    },
    locale: (() => {
      // Must be a stable reference: useSyncExternalStore re-renders forever
      // when getSnapshot returns a fresh object on every call.
      const snapshot = { active: options.locale ?? 'zh', locales: [], revision: 1 }
      return { getSnapshot: () => snapshot, subscribe: () => () => {} }
    })(),
  })

  return { dom, window, registrations, fetched, React }
}

test('client registers four native surfaces by default (context-plugin layout)', async () => {
  const { registrations } = await mountClient()
  const names = registrations.map((item) => item.registration.name).sort()
  assert.deepEqual(names, ['conversation.chat.turnTail', 'main', 'plugins.bundle.config', 'sidebar.panellist'])
})

test('the board uses the sidebar panel + main panel seats like the context plugin', async () => {
  const { registrations } = await mountClient()
  const panel = registrations.find((item) => item.registration.name === 'sidebar.panellist')
  assert.equal(panel.registration.id, 'skill-eval')
  assert.equal(panel.registration.order, 40)
  assert.equal(typeof panel.registration.label, 'function')
  const main = registrations.find((item) => item.registration.name === 'main')
  assert.equal(main.registration.key, 'skill-eval')
  const config = registrations.find((item) => item.registration.name === 'plugins.bundle.config')
  assert.equal(config.registration.key, 'dsh-skill-eval')
})

test('the panel icon draws the gauge at the requested size', async () => {
  const { window, registrations, React } = await mountClient()
  const Icon = registrations.find((item) => item.registration.name === 'sidebar.panellist').Component
  const { host, root } = createHost(window)
  await act(async () => {
    root.render(React.createElement(Icon, { size: 22, active: true }))
  })
  assert.ok(host.querySelector('svg'))
  assert.equal(host.textContent.length, 0)
})

test('the main panel renders the board and switches tabs', async () => {
  const { window, registrations, fetched, React } = await mountClient()
  const Panel = registrations.find((item) => item.registration.name === 'main').Component
  const { host, root } = createHost(window, { height: '600px' })
  await act(async () => {
    root.render(React.createElement(Panel))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  assert.match(fetched[0], /^\/skill-eval\/data\/\d+\.\d+\.\d+$/)
  const text = host.textContent
  assert.match(text, /技能评测/)
  assert.match(text, /pdf-tools/)
  assert.match(text, /89\.5/)
  assert.ok(host.querySelector('.sev-card'))
  assert.ok(host.querySelector('.sev-charts'), 'chart grid renders')
  assert.ok(host.querySelectorAll('.sev-chart').length >= 3, 'at least three chart cards')
  assert.ok(host.querySelectorAll('.sev-chart svg').length >= 3, 'charts are SVG')
  assert.ok(host.querySelector('.sev-spark'), 'skill trend sparkline renders')
  assert.match(host.querySelector('.sev-spark').getAttribute('aria-label'), /趋势/)

  const tabs = [...host.querySelectorAll('.sev-tab')]
  assert.deepEqual(
    tabs.map((tab) => tab.textContent),
    ['按技能', '轨迹', '按运行', 'MCP', '开发者'],
  )
  await act(async () => {
    tabs[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  assert.match(host.textContent, /步均分/)
  assert.match(host.textContent, /回合均分/)
  assert.match(host.textContent, /轨迹/)
  assert.ok(host.querySelector('.sev-turn'))
  await act(async () => {
    tabs[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  assert.match(host.textContent, /ef123456/)
  await act(async () => {
    tabs[3].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  assert.match(host.textContent, /context7/)
})

test('a skill trace button opens the trajectory filtered to that skill', async () => {
  const { window, registrations, React } = await mountClient()
  const Panel = registrations.find((item) => item.registration.name === 'main').Component
  const { host, root } = createHost(window, { height: '600px' })
  await act(async () => {
    root.render(React.createElement(Panel))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  const trace = host.querySelector('.sev-trace')
  assert.ok(trace, 'skill card exposes a trace button')
  await act(async () => {
    trace.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  assert.ok(host.querySelector('.sev-steps'))
  assert.equal(host.querySelectorAll('.sev-turn').length, 1, 'filtered to the one turn that loaded pdf-tools')
  const selected = [...host.querySelectorAll('.sev-step-filters .sev-chip')].find((chip) =>
    chip.classList.contains('sev-chip--on'),
  )
  assert.equal(selected.textContent, 'pdf-tools')
  const all = [...host.querySelectorAll('.sev-step-filters .sev-chip')].find((chip) => chip.textContent === '全部')
  await act(async () => {
    all.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(host.querySelectorAll('.sev-turn').length, 2, 'all filter restores both turns')
})

test('the panel copy button falls back to execCommand and confirms', async () => {
  const { window, registrations, React } = await mountClient()
  const Panel = registrations.find((item) => item.registration.name === 'main').Component
  const copied = []
  window.document.execCommand = (command) => {
    if (command === 'copy') {
      const area = window.document.querySelector('textarea')
      copied.push(area ? area.value : '')
    }
    return true
  }
  const { host, root } = createHost(window)
  await act(async () => {
    root.render(React.createElement(Panel))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  const button = [...host.querySelectorAll('.sev-btn')].find((node) =>
    /复制给 agent|Copy for agent/.test(node.textContent),
  )
  assert.ok(button, 'copy button exists')
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(copied.length, 1)
  assert.match(copied[0], /pdf-tools/)
  // The confirmation label is a React state update; it is verified in the real
  // window (docs/UI-REVIEW.md), while this test pins the fallback payload path.
})

test('the config button opens the in-panel settings instead of window.open', async () => {
  const { window, registrations, React } = await mountClient()
  const Panel = registrations.find((item) => item.registration.name === 'main').Component
  const opened = []
  window.open = (...args) => {
    opened.push(args)
    return null
  }
  const { host, root } = createHost(window)
  await act(async () => {
    root.render(React.createElement(Panel))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  const button = [...host.querySelectorAll('.sev-head-actions .sev-btn')].find(
    (node) => node.textContent === '配置' || node.textContent === 'Configure',
  )
  assert.ok(button, 'config button exists')
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 40))
  })
  // The desktop shell denies every popup, so the button must not depend on one.
  assert.equal(opened.length, 0, 'no window.open call')
  const dialog = host.querySelector('[role="dialog"]')
  assert.ok(dialog, 'settings dialog is rendered')
  assert.match(dialog.textContent, /评分配置|Scoring settings/)
  // A link the shell cannot honour is worse than no link.
  assert.equal(/在网页里打开|Open in the web/.test(dialog.textContent), false)
  // Escape closes it and restores the board.
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
  })
  assert.equal(host.querySelector('[role="dialog"]'), null)
})

test('the bundle config page renders the settings form', async () => {
  const { window, registrations, React } = await mountClient()
  const Config = registrations.find((item) => item.registration.name === 'plugins.bundle.config').Component
  const { host, root } = createHost(window)
  await act(async () => {
    root.render(React.createElement(Config, { view: 'summary' }))
  })
  assert.match(host.textContent, /评分权重/)
  await act(async () => {
    root.render(React.createElement(Config, { view: 'page' }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  assert.ok(host.querySelectorAll('input[type="number"]').length > 0)
  assert.ok(host.querySelectorAll('input[type="checkbox"]').length > 0)
})

test('the replaced seats are gone (no detail section, row config, More row or sidebar button)', async () => {
  const { registrations } = await mountClient()
  for (const name of [
    'plugins.detail.section',
    'plugins.row.config',
    'conversation.session.header.views.actions',
    'sidebar.footer.action',
  ]) {
    assert.equal(
      registrations.some((item) => item.registration.name === name),
      false,
      name,
    )
  }
})

test('the optional popup adds only the debug sidebar button and overlay', async () => {
  const { registrations } = await mountClient({ popup: true })
  const names = registrations.map((entry) => entry.registration.name).sort()
  assert.deepEqual(names, [
    'conversation.chat.turnTail',
    'main',
    'plugins.bundle.config',
    'shell.overlay',
    'sidebar.footer.action',
    'sidebar.panellist',
  ])
})

test('the turn card renders under the turn that loaded a skill and hides elsewhere', async () => {
  const { window, registrations, React } = await mountClient()
  const TurnCard = registrations.find((item) => item.registration.name === 'conversation.chat.turnTail').Component
  const nodes = new Map([
    ['a', { kind: 'tool-call', location: { kind: 'step', turn: { turn: 2 } } }],
    ['b', { kind: 'tool-call', location: { kind: 'step', turn: { turn: 2 } }, data: { isError: true } }],
  ])
  const useChat = (selector) => selector({ nodes })

  const { host, root } = createHost(window)
  const render = (turn) =>
    act(async () => {
      root.render(React.createElement(TurnCard, { sessionId: 'session-abc', turn, useChat }))
    })

  await render({ turn: 2, status: 'closed' })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
  })
  assert.match(host.textContent, /技能评测/)
  assert.match(host.textContent, /pdf-tools/)
  assert.match(host.textContent, /2 调用 · 1 错误/)
  // the strip points at the next fix instead of only listing history
  assert.match(host.textContent, /下一步 · 可改/)
  assert.match(host.textContent, /有效性/)
  assert.match(host.textContent, /user rejects the result/i)
  assert.match(host.textContent, /改动记录/)
  assert.match(host.textContent, /sharpen triggers/)
  // a turn can load more than one skill: every skill gets a chip and its own next fix
  assert.equal(host.querySelectorAll('.sev-turn-chip').length, 2, 'both loaded skills get a chip')
  assert.match(host.textContent, /caveman-help/)
  const nextSteps = [...host.querySelectorAll('.sev-turn-next')]
  assert.equal(nextSteps.length, 2, 'one next fix per loaded skill')
  assert.match(nextSteps.map((node) => node.textContent).join(' | '), /pdf-tools/)
  assert.match(nextSteps.map((node) => node.textContent).join(' | '), /caveman-help/)
  assert.match(host.textContent, /does not say when to use this skill/)

  await render({ turn: 2, status: 'running' })
  assert.equal(host.textContent.includes('技能评测'), false)

  await render({ turn: 9, status: 'closed' })
  assert.equal(host.textContent.includes('技能评测'), false)
})

test('the English turn strip has no undefined placeholder strings', async () => {
  const { window, registrations, React } = await mountClient({ locale: 'en' })
  const TurnCard = registrations.find((item) => item.registration.name === 'conversation.chat.turnTail').Component
  const nodes = new Map([['a', { kind: 'tool-call', location: { kind: 'step', turn: { turn: 2 } } }]])
  const useChat = (selector) => selector({ nodes })
  const { host, root } = createHost(window)
  await act(async () => {
    root.render(
      React.createElement(TurnCard, { sessionId: 'session-abc', turn: { turn: 2, status: 'closed' }, useChat }),
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
  })
  assert.equal(host.textContent.includes('undefined'), false)
  assert.match(host.textContent, /calls/)
})

test('clicking the sidebar action opens the modal with scores and fixes', async () => {
  const { window, registrations, fetched, React } = await mountClient({}, { popup: true })

  const FooterAction = registrations.find((r) => r.registration.name === 'sidebar.footer.action').Component
  const Overlay = registrations.find((r) => r.registration.name === 'shell.overlay').Component

  const { root } = createHost(window)

  await act(async () => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(FooterAction, { wide: true }),
        React.createElement(Overlay, null),
      ),
    )
  })

  const button = window.document.querySelector('button.sev-btn')
  assert.ok(button, 'sidebar button not rendered')
  assert.match(button.textContent, /技能评测/)
  assert.equal(window.document.querySelector('[role="dialog"]'), null)

  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  assert.match(fetched[0], /^\/skill-eval\/data\/\d+\.\d+\.\d+$/)
  const dialog = window.document.querySelector('[role="dialog"]')
  assert.ok(dialog, 'modal did not open')
  const text = dialog.textContent
  assert.match(text, /pdf-tools/)
  assert.match(text, /89\.5/)
  assert.match(text, /B/)
  assert.match(text, /可靠性/)
  assert.match(text, /Tighten the output contract/)
  assert.match(text, /95% CI 78\.2 – 96\.4/)
  assert.match(text, /rank is not significant/)
  assert.match(text, /已结算/)

  // Escape closes it
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
  })
  assert.equal(window.document.querySelector('[role="dialog"]'), null)
})

test('an empty dataset renders the empty state instead of a broken dialog', async () => {
  const { window, registrations, React } = await mountClient(
    {
      report: { generatedAt: '', dataDir: '/tmp/x', totals: { invocations: 0, skills: 0 }, skills: [] },
    },
    { popup: true },
  )
  const Overlay = registrations.find((r) => r.registration.name === 'shell.overlay').Component
  const FooterAction = registrations.find((r) => r.registration.name === 'sidebar.footer.action').Component

  const { root } = createHost(window)
  await act(async () => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(FooterAction, { wide: false }),
        React.createElement(Overlay, null),
      ),
    )
  })
  const button = window.document.querySelector('button.sev-btn')
  assert.ok(button.classList.contains('sev-btn--icon'), 'collapsed rail should render the icon-only button')

  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  const dialog = window.document.querySelector('[role="dialog"]')
  assert.ok(dialog)
  assert.match(dialog.textContent, /还没有记录到技能加载/)
})

test('a failed fetch surfaces an error row with the route it tried', async () => {
  const { window, registrations, React } = await mountClient({ failFetch: true }, { popup: true })
  const Overlay = registrations.find((r) => r.registration.name === 'shell.overlay').Component
  const FooterAction = registrations.find((r) => r.registration.name === 'sidebar.footer.action').Component

  const { root } = createHost(window)
  await act(async () => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(FooterAction, { wide: true }),
        React.createElement(Overlay, null),
      ),
    )
  })
  const button = window.document.querySelector('button.sev-btn')
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  const dialog = window.document.querySelector('[role="dialog"]')
  assert.ok(dialog)
  assert.match(dialog.textContent, /读取失败/)
  assert.match(dialog.textContent, /\/skill-eval\/data/)
})

test('the modal follows the active locale', async () => {
  const { window, registrations, React } = await mountClient({ locale: 'en' }, { popup: true })
  const Overlay = registrations.find((r) => r.registration.name === 'shell.overlay').Component
  const FooterAction = registrations.find((r) => r.registration.name === 'sidebar.footer.action').Component
  const { root } = createHost(window)
  await act(async () => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(FooterAction, { wide: true }),
        React.createElement(Overlay, null),
      ),
    )
  })
  const button = window.document.querySelector('button.sev-btn')
  assert.match(button.textContent, /Skill eval/)
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  assert.match(window.document.querySelector('[role="dialog"]').textContent, /reliability/)
})

test('the open report keeps refreshing so a running task updates live', async () => {
  const { window, registrations, fetched, React } = await mountClient({}, { popup: true })
  const FooterAction = registrations.find((r) => r.registration.name === 'sidebar.footer.action').Component
  const Overlay = registrations.find((r) => r.registration.name === 'shell.overlay').Component

  const { root } = createHost(window)
  await act(async () => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(FooterAction, { wide: true }),
        React.createElement(Overlay, null),
      ),
    )
  })
  const button = window.document.querySelector('button.sev-btn')
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  const afterOpen = fetched.length
  assert.ok(afterOpen >= 1, 'opening must fetch at least once')

  // the compressed poll interval should fire while the modal stays open
  await act(async () => {
    await waitFor(() => fetched.length > afterOpen)
  })
  assert.ok(fetched.length > afterOpen, 'expected the open report to poll: ' + fetched.length)
  assert.match(window.document.querySelector('.sev-foot').textContent, /自动刷新/)

  // closing stops the polling
  await act(async () => {
    window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }))
  })
  const afterClose = fetched.length
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 120))
  })
  // at most one already-queued tick may still land
  assert.ok(fetched.length - afterClose <= 1, 'polling must stop once closed: ' + (fetched.length - afterClose))
})

test('the popup switches between skills, runs and MCP boards', async () => {
  const { window, registrations, React } = await mountClient({}, { popup: true })
  const FooterAction = registrations.find((r) => r.registration.name === 'sidebar.footer.action').Component
  const Overlay = registrations.find((r) => r.registration.name === 'shell.overlay').Component

  const { root } = createHost(window)
  await act(async () => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(FooterAction, { wide: true }),
        React.createElement(Overlay, null),
      ),
    )
  })
  const button = window.document.querySelector('button.sev-btn')
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  const tabs = [...window.document.querySelectorAll('.sev-tab')]
  assert.deepEqual(
    tabs.map((tab) => tab.textContent),
    ['按技能', '轨迹', '按运行', 'MCP', '开发者'],
  )
  assert.ok(tabs[0].classList.contains('sev-tab--on'))
  assert.match(window.document.querySelector('[role="dialog"]').textContent, /pdf-tools/)

  await act(async () => {
    tabs[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  assert.match(window.document.querySelector('[role="dialog"]').textContent, /步均分/)
  await act(async () => {
    tabs[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  const runsText = window.document.querySelector('[role="dialog"]').textContent
  assert.match(runsText, /ef123456/)
  assert.match(runsText, /62\.5/)
  assert.match(runsText, /D/)
  assert.ok(tabs[2].classList.contains('sev-tab--on'))

  await act(async () => {
    tabs[3].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  const text = window.document.querySelector('[role="dialog"]').textContent
  assert.match(text, /context7/)
  assert.match(text, /180ms \/ 420ms/)
  assert.match(text, /65/)
  // failing MCP tools are listed under the server table
  assert.match(text, /出错的工具/)
  assert.match(text, /MCP 修复建议/)
  assert.match(text, /Check the server process/)
  assert.match(text, /context7\/query-docs/)
  assert.match(text, /2\/3/)
})

test('the developer tab shows the active scoring standard and data paths', async () => {
  const { window, registrations, React } = await mountClient({}, { popup: true })
  const FooterAction = registrations.find((r) => r.registration.name === 'sidebar.footer.action').Component
  const Overlay = registrations.find((r) => r.registration.name === 'shell.overlay').Component
  const { root } = createHost(window)
  await act(async () => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(FooterAction, { wide: true }),
        React.createElement(Overlay, null),
      ),
    )
  })
  const button = window.document.querySelector('button.sev-btn')
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  const tabs = [...window.document.querySelectorAll('.sev-tab')]
  await act(async () => {
    tabs[4].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  const text = window.document.querySelector('[role="dialog"]').textContent
  assert.match(text, /评分权重/)
  assert.match(text, /static 30/)
  assert.match(text, /A≥90/)
  assert.match(text, /\/skill-eval\/data/)
  assert.match(text, /\/Users\/adams\/\.dsh\/skill-eval\/default/)

  // the footer also states the standard so a config change is visible immediately
  assert.match(window.document.querySelector('.sev-foot').textContent, /static 30\/reliability 25/)
})

test('client version matches the package version so the route alias lines up', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(CLIENT_FILE, 'utf8')
  const match = source.match(/const DATA_VERSION = '([^']+)'/)
  assert.ok(match, 'DATA_VERSION constant is missing')
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(match[1], manifest.version)
})

test('the popup falls back to the unversioned route when the host predates it', async () => {
  const { window, registrations, fetched, React } = await mountClient({ versionedMissing: true }, { popup: true })
  const FooterAction = registrations.find((r) => r.registration.name === 'sidebar.footer.action').Component
  const Overlay = registrations.find((r) => r.registration.name === 'shell.overlay').Component
  const { root } = createHost(window)
  await act(async () => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(FooterAction, { wide: true }),
        React.createElement(Overlay, null),
      ),
    )
  })
  const button = window.document.querySelector('button.sev-btn')
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
  })
  assert.equal(fetched[0].startsWith('/skill-eval/data/'), true)
  assert.equal(fetched[1], '/skill-eval/data')
  assert.match(window.document.querySelector('[role="dialog"]').textContent, /pdf-tools/)
})

test('an older-generation payload shows the restart banner instead of pretending', async () => {
  const legacy = { generatedAt: 'x', dataDir: '/tmp/d', totals: { invocations: 1, skills: 1 }, skills: [] }
  const { window, registrations, React } = await mountClient({ report: legacy }, { popup: true })
  const FooterAction = registrations.find((r) => r.registration.name === 'sidebar.footer.action').Component
  const Overlay = registrations.find((r) => r.registration.name === 'shell.overlay').Component
  const { root } = createHost(window)
  await act(async () => {
    root.render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(FooterAction, { wide: true }),
        React.createElement(Overlay, null),
      ),
    )
  })
  const button = window.document.querySelector('button.sev-btn')
  await act(async () => {
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
  })
  const dialog = window.document.querySelector('[role="dialog"]')
  assert.ok(dialog)
  assert.match(dialog.textContent, /旧一代插件/)
  assert.match(dialog.textContent, /重启/)
})

test('the turn card tolerates a missing status and hides only clearly in-flight turns', async () => {
  const { window, registrations, React } = await mountClient()
  const TurnCard = registrations.find((item) => item.registration.name === 'conversation.chat.turnTail').Component
  const useChat = (selector) => selector({ nodes: new Map() })
  const { host, root } = createHost(window)
  const render = (turn) =>
    act(async () => {
      root.render(React.createElement(TurnCard, { sessionId: 'session-abc', turn, useChat }))
    })

  // no status field at all, but the turn matches a recorded load
  await render({ turn: 2 })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
  })
  assert.match(host.textContent, /pdf-tools/)

  // an explicitly running turn stays hidden
  await render({ turn: 2, status: 'running' })
  assert.equal(host.textContent.includes('pdf-tools'), false)

  // alternative numeric field names still match
  await render({ number: 2, status: 'closed' })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25))
  })
  assert.match(host.textContent, /pdf-tools/)
})

const LIVE_OLD_REPORT = JSON.parse(await readFile(new URL('./fixtures/live-1.10.1.json', import.meta.url), 'utf8'))

test('the native settings page explains that an old host needs a restart', async () => {
  const { window, registrations, React } = await mountClient({ settingsHtml: true })
  const RowConfig = registrations.find((item) => item.registration.name === 'plugins.bundle.config').Component
  const { host, root } = createHost(window)
  await act(async () => {
    root.render(React.createElement(RowConfig, { view: 'page' }))
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  assert.match(host.textContent, /重启 DeepSeek Harness/)
  assert.match(host.textContent, /网页配置页|在网页里打开/)
})

test('the new client still renders the older host payload shipped by 1.10.x', async () => {
  assert.equal(LIVE_OLD_REPORT.validity, undefined)
  assert.equal(LIVE_OLD_REPORT.edits, undefined)
  assert.ok(Array.isArray(LIVE_OLD_REPORT.turnLoads) && LIVE_OLD_REPORT.turnLoads.length > 0)
  const { window, registrations, React } = await mountClient({ report: LIVE_OLD_REPORT })
  const turnRow = LIVE_OLD_REPORT.turnLoads[0]
  const TurnCard = registrations.find((item) => item.registration.name === 'conversation.chat.turnTail').Component
  const { host, root } = createHost(window)
  await act(async () => {
    root.render(
      React.createElement(TurnCard, {
        sessionId: turnRow.sessionId,
        turn: { turn: turnRow.turn, status: 'closed' },
        useChat: (selector) => selector({ nodes: new Map() }),
      }),
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30))
  })
  assert.match(host.textContent, /技能评测/)
  assert.ok(host.textContent.length > 10)

  // the remaining native surfaces must also tolerate the old payload
  const RowConfig = registrations.find((item) => item.registration.name === 'plugins.bundle.config').Component
  const configHost = window.document.createElement('div')
  window.document.body.appendChild(configHost)
  const configRoot = createRoot(configHost)
  await act(async () => {
    configRoot.render(React.createElement(RowConfig, { view: 'summary' }))
  })
  assert.match(configHost.textContent, /评分权重/)
})
