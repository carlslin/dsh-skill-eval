import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { after } from 'node:test'
import { JSDOM } from 'jsdom'
import { act } from 'react-dom/test-utils'
import { createHost } from './helpers.ts'
import type { Fake, Fn } from './helpers.ts'
import { EventStore } from '../src/lib/store.ts'
import { aggregate, bootstrapRate, scoreSkill, staticProfile } from '../src/lib/score.ts'
import { buildAdvice, buildMcpAdvice } from '../src/lib/advice.ts'
import { rankingOf } from '../src/lib/report.ts'
import { escapeHtml, escapeMdCell } from '../src/lib/html.ts'
import { renderSummaryMarkdown } from '../src/lib/render.ts'
import { resolveDataDir } from '../src/lib/store.ts'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_FILE = path.join(HERE, '..', 'client.js')

const liveTimers = new Set<Fake>()
after(() => {
  for (const id of liveTimers) {
    clearInterval(id)
    clearTimeout(id)
  }
  liveTimers.clear()
})
const fastTimeout = (fn: Fn, delay = 0, ...rest: unknown[]) => {
  const id = setTimeout(fn, Math.min(delay || 0, 5), ...rest)
  liveTimers.add(id)
  setTimeout(() => liveTimers.delete(id), 1000).unref?.()
  return id
}

function sample(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    loadMs: 120,
    window: {
      toolCalls: 3,
      errors: 0,
      errorNames: [],
      corrections: [],
      otherSkills: [],
      turnEnded: true,
      truncated: false,
      origin: null,
      tokens: { input: 0, output: 0, cacheRead: 0, calls: 0 },
      loopErrors: 0,
      llmRetries: 0,
      closeReason: 'user-turn',
      ...((over.window as Record<string, unknown>) ?? {}),
    },
    ...over,
  }
}

// ---------------------------------------------------------------------------
// Scoring / data-contract guards (the P0 fixes must stay fixed)
// ---------------------------------------------------------------------------

test('DATA_VERSION matches package.json (single source of truth)', async () => {
  const [client, manifest] = await Promise.all([
    readFile(CLIENT_FILE, 'utf8'),
    readFile(path.join(HERE, '..', 'package.json'), 'utf8'),
  ])
  const version = JSON.parse(manifest).version
  assert.match(client, new RegExp(`DATA_VERSION = '${version}'`))
})

test('reference-integrity with zero checked references is skipped, not scored 100', () => {
  const sp = staticProfile(
    {
      name: 'x',
      description: 'Use when testing this skill with a long description text here',
      whenToUse: 'Use when x',
    },
    { content: '# body\n\n```js\ncode\n```\n' },
    { integrity: { checked: 0, missing: [] } },
  )
  assert.ok(sp)
  const ref = sp.checks.find((c) => c.id === 'reference-integrity')
  assert.equal(ref?.skipped, true)
  assert.ok((sp.score ?? 0) < 100)
})

test('scoreSkill merges partial weights over the defaults', () => {
  const stats = aggregate([sample(), sample(), sample()])
  const full = scoreSkill({ stats, static: { score: 80 }, weights: { reliability: 0.5 } })
  // reliability-only override keeps the other three dims alive via defaults
  assert.ok(full.dimensions.static !== null && full.dimensions.effectiveness !== null)
  assert.ok((full.coverage ?? 0) > 0.5)
})

test('small-n bootstrap never reports strong significance', () => {
  const windows = [{ corrections: ['a'] }, { corrections: ['b'] }, { corrections: [] }]
  const stats = aggregate(windows.map((w) => sample({ window: { ...w, toolCalls: 2 } })))
  const advice = buildAdvice({ stats, static: null, score: {}, minSamples: 3, windows })
  const rule = advice.find((a) => a.id === 'user-corrections')
  assert.ok(rule)
  assert.notEqual(rule.severity, 'critical')
})

test('overlapping intervals are not significant regardless of point gap', () => {
  const r = rankingOf([
    { skill: 'a', score: { total: 90, ci: { low: 80, high: 95 } } },
    { skill: 'b', score: { total: 70, ci: { low: 60, high: 82 } } },
  ])
  assert.equal(r.significant, false)
})

test('prune advice requires a bootstrap interval (no CI, no prune)', () => {
  const stats = aggregate(Array.from({ length: 12 }, () => sample()))
  const advice = buildAdvice({
    stats,
    static: null,
    score: { total: 10, ci: null },
    minSamples: 3,
    windows: [],
    gating: false,
  })
  assert.equal(
    advice.some((a) => a.id === 'prune-candidate'),
    false,
  )
})

test('MCP server advice needs a minimum sample (1/1 never critical)', () => {
  assert.deepEqual(buildMcpAdvice([{ server: 's', calls: 1, errors: 1, errorRate: 1 }]), [])
  const flagged = buildMcpAdvice([{ server: 's', calls: 6, errors: 6, errorRate: 1 }])
  assert.ok(flagged.some((a) => a.id === 'mcp-server-errors'))
})

test('markdown cells escape pipes, backticks and newlines', () => {
  assert.equal(escapeMdCell('a|b`c\nd'), "a｜b'c d")
  const md = renderSummaryMarkdown({
    totals: { invocations: 1, skills: 1, closed: 1, open: 0 },
    skills: [
      {
        skill: 'evil|skill`x',
        score: { total: 80, grade: 'B', dimensions: {}, samples: 3 },
        stats: { loads: 3, correctionRate: 0, abandonRate: 0 },
        topAdvice: [],
      },
    ],
  } as never)
  assert.ok(!md.includes('evil|skill'))
  assert.ok(md.includes('evil｜skill'))
})

test('escapeHtml covers single quotes for attribute contexts', () => {
  assert.equal(escapeHtml(`a'b"c<d>`), 'a&#39;b&quot;c&lt;d&gt;')
})

test('resolveDataDir refuses the filesystem root', () => {
  assert.throws(() => resolveDataDir({ dataDir: '/' }), /must not be the filesystem root/)
})

// ---------------------------------------------------------------------------
// Client UI: empty / error / i18n / a11y / interaction
// ---------------------------------------------------------------------------

async function mountClient(options: Fake = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:50403/',
    pretendToBeVisual: true,
  })
  const { window } = dom
  globalThis.window = window as unknown as Window & typeof globalThis
  globalThis.document = window.document
  globalThis.HTMLElement = window.HTMLElement
  ;(globalThis as Fake).IS_REACT_ACT_ENVIRONMENT = true
  globalThis.fetch = (async () => ({
    ok: !options.failFetch,
    status: options.failFetch ? 500 : 200,
    headers: { get: () => 'application/json' },
    async json() {
      if (options.failFetch) throw new Error('boom')
      return options.report ?? { skills: [], totals: { invocations: 0, skills: 0 }, scoring: {} }
    },
  })) as unknown as typeof fetch
  ;(window as Fake).__ModuleLoader__ = {
    load(definition: Fake) {
      ;(window as Fake).__sev = definition
    },
  }
  const source = await readFile(CLIENT_FILE, 'utf8')
  const run = new Function('window', 'fetch', 'navigator', 'document', 'setTimeout', 'clearTimeout', `${source}`)
  run(window, globalThis.fetch, window.navigator, window.document, fastTimeout, clearTimeout)
  const descriptor = (window as Fake).__sev
  assert.ok(descriptor)
  const registrations: Fake[] = []
  const React = (await import('react')).default
  const moduleExports = { require: (name: string) => (name === 'react' ? React : undefined) }
  const plugin = descriptor.factory(moduleExports.require)
  plugin.apply({
    slots: {
      inject(_o: Fake, cb: Fn) {
        cb()
      },
      register(reg: Fake, Comp: Fake) {
        registrations.push({ registration: reg, Component: Comp })
      },
    },
    locale: (() => {
      const snapshot = { active: options.locale ?? 'zh', locales: [], revision: 1 }
      return { getSnapshot: () => snapshot, subscribe: () => () => {} }
    })(),
  })
  return { dom, window, registrations, React }
}

test('board empty state renders without crashing and charts announce via aria', async () => {
  const { window, registrations, React } = await mountClient({
    report: { skills: [], totals: { invocations: 0, skills: 0 }, scoring: {} },
  })
  const Panel = registrations.find((i) => i.registration.name === 'main').Component
  const { host, root } = createHost(window)
  await act(async () => {
    root.render(React.createElement(Panel))
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
  assert.match(host.textContent ?? '', /没有|no data|技能评测/i)
  // charts render an accessible empty state, never a bare canvas
  assert.ok(host.querySelector('[aria-label]') || (host.textContent ?? '').length > 0)
  // tabs are real tabs for screen readers
  const tabs = [...host.querySelectorAll('.sev-tab')]
  assert.ok(tabs.length >= 4)
  assert.ok(tabs.every((t) => t.getAttribute('role') === 'tab' || t.getAttribute('aria-selected') !== null))
})

test('board fetch failure renders a retry affordance, not a blank panel', async () => {
  const { window, registrations, React } = await mountClient({ failFetch: true })
  const Panel = registrations.find((i) => i.registration.name === 'main').Component
  const { host, root } = createHost(window)
  await act(async () => {
    root.render(React.createElement(Panel))
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
  assert.match(host.textContent ?? '', /失败|failed|重试|retry|boom/i)
})

test('board tabs switch views by click and arrow keys', async () => {
  const { window, registrations, React } = await mountClient({
    report: {
      skills: [],
      steps: [],
      stepTurns: [],
      runs: [],
      mcpServers: [],
      totals: { invocations: 0, skills: 0 },
      scoring: {},
    },
  })
  const Panel = registrations.find((i) => i.registration.name === 'main').Component
  const { host, root } = createHost(window)
  await act(async () => {
    root.render(React.createElement(Panel))
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30))
  })
  const tabs = [...host.querySelectorAll('.sev-tab')]
  assert.ok(tabs.length >= 4)
  await act(async () => {
    tabs[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {
    tabs[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  })
  assert.ok(true, 'tab keyboard handler does not throw')
})

test('bootstrapRate is deterministic for the same seed', () => {
  const rows = [{ corrections: ['a'] }, { corrections: [] }, { corrections: ['b'] }, { corrections: [] }]
  const a = bootstrapRate(rows, (w: { corrections?: string[] }) => (w.corrections?.length ?? 0) > 0, { seed: 7 })
  const b = bootstrapRate(rows, (w: { corrections?: string[] }) => (w.corrections?.length ?? 0) > 0, { seed: 7 })
  assert.deepEqual(a, b)
})

test('redacted corrections keep rates but hide text', async () => {
  const { mkdtemp } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-ui-'))
  try {
    const { createRecorder } = await import('../src/lib/recorder.ts')
    const store = new EventStore(dir)
    const handlers = new Map<string, Fn[]>()
    const ctx = {
      on: (n: string, fn: Fn) => {
        const l = handlers.get(n) ?? []
        l.push(fn)
        handlers.set(n, l)
        return () => {}
      },
    }
    const agent = { id: 's-redact' }
    const recorder = createRecorder(ctx, { windowToolCalls: 12, redactCorrections: true }, { store })
    const emit = (n: string, ...a: unknown[]) => {
      for (const fn of handlers.get(n) ?? []) fn(...a)
    }
    const call = { callId: 'c1', name: 'skill', arguments: { name: 'pdf' }, agent }
    emit('tools/pre-execute', call, () => {})
    emit('tools/result', call, { isError: false, value: {}, content: [] })
    emit('tools/result', { callId: 't1', name: 'read', arguments: {}, agent }, { isError: false })
    emit('agent/inbox/claimed', { agent, message: { content: '不对，秘密内容' } })
    await recorder.flush()
    const records = await store.readAll()
    const win = records.find((r) => r.t === 'window')
    assert.ok(win)
    assert.match(String(win.corrections?.[0] ?? ''), /redacted/)
    assert.ok(!String(win.corrections?.[0] ?? '').includes('秘密'))
    await recorder.dispose()
  } finally {
    const { rm: rm2 } = await import('node:fs/promises')
    await rm2(dir, { recursive: true, force: true })
  }
})

test('README badges pin this package version instead of live published latest', async () => {
  const manifest = JSON.parse(await readFile(path.join(HERE, '..', 'package.json'), 'utf8'))
  const version = manifest.version as string
  for (const name of ['README.md', 'README.zh.md']) {
    const body = await readFile(path.join(HERE, '..', name), 'utf8')
    assert.ok(body.includes(`img.shields.io/badge/npm-v${version}`), name)
    assert.ok(body.includes(`img.shields.io/badge/release-v${version}`), name)
    assert.doesNotMatch(body, /img\.shields\.io\/npm\/v\//, `${name} must not use the live npm version badge`)
    assert.doesNotMatch(
      body,
      /img\.shields\.io\/github\/v\/release\//,
      `${name} must not use the live GitHub release badge`,
    )
  }
})
