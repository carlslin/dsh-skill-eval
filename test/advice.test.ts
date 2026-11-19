import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregate, scoreSkill, staticProfile } from '../src/lib/score.ts'
import { buildAdvice, buildMcpAdvice, localizeAdvice, topAdvice } from '../src/lib/advice.ts'
import { renderHtml, renderSkillMarkdown, renderSummaryMarkdown } from '../src/lib/render.ts'
import type { Report, SkillEntry } from '../src/lib/report.ts'
import type { Sample, WindowRecord } from '../src/lib/types.ts'
import { byId, partial } from './helpers.ts'

const GOOD_SKILL = {
  name: 'pdf-tools',
  description:
    'Use when the user needs to extract, split, merge or annotate PDF files: read page text, reorder pages, fill forms, export images.',
  whenToUse: 'Any task whose input or output is a .pdf file.',
  source: 'user-dsh',
  invocation: { modelInvocable: true, userInvocable: true },
  provider: 'filesystem',
}

const GOOD_BODY = `# PDF

## When to use
Use when the input is a PDF.

## Steps
1. Inspect with \`scripts/inspect.py\`.
2. Read \`references/forms.md\` for forms.

\`\`\`bash
python scripts/inspect.py a.pdf
\`\`\`
`

function sample(overrides: Omit<Sample, 'window'> & { window?: WindowRecord | null } = {}) {
  return {
    at: Date.now(),
    ok: true,
    loadMs: 100,
    window: {
      toolCalls: 3,
      errors: 0,
      errorNames: [],
      corrections: [],
      otherSkills: [],
      turnEnded: true,
      truncated: false,
      ...overrides.window,
    },
    ...overrides,
  }
}

function analyze(samples: Sample[], sp: ReturnType<typeof staticProfile> = null) {
  const stats = aggregate(samples)
  const score = scoreSkill({ stats, static: sp, minSamples: 3 })
  return { stats, score, advice: buildAdvice({ stats, static: sp, score, minSamples: 3 }) }
}

test('every advice rule carries Chinese copy, and localizeAdvice picks it', () => {
  const { advice } = analyze([
    sample({ ok: false, error: 'ENOENT: SKILL.md', window: null }),
    sample({ ok: false, error: 'ENOENT: SKILL.md', window: null }),
    sample({ ok: false, error: 'ENOENT: SKILL.md', window: null }),
  ])
  const rule = byId(advice, 'load-failed')
  assert.ok(rule.titleZh && rule.fixZh, 'rule carries titleZh/fixZh')
  const zh = localizeAdvice(rule, 'zh')
  assert.equal(zh.title, rule.titleZh)
  assert.match(zh.title, /加载失败/)
  assert.equal(localizeAdvice(rule, 'en').title, rule.title)
  const mcp = buildMcpAdvice([{ server: 'bad-server', calls: 6, errors: 3, errorRate: 0.5 }])
  const mcpRule = byId(mcp, 'mcp-server-errors')
  assert.match(localizeAdvice(mcpRule, 'zh').title, /bad-server/)
  assert.match(localizeAdvice(mcpRule, 'zh').fix, /服务器进程/)
})

test('a healthy skill produces no critical advice', () => {
  const { advice } = analyze([sample(), sample(), sample()], staticProfile(GOOD_SKILL, { content: GOOD_BODY }))
  assert.equal(advice.filter((a) => a.severity === 'critical').length, 0)
})

test('load failures are critical and cite the error', () => {
  const { advice } = analyze([
    sample({ ok: false, error: 'ENOENT: SKILL.md', window: null }),
    sample({ ok: false, error: 'ENOENT: SKILL.md', window: null }),
    sample({ ok: false, error: 'ENOENT: SKILL.md', window: null }),
  ])
  const rule = byId(advice, 'load-failed')
  assert.ok(rule)
  assert.equal(rule.severity, 'critical')
  assert.match(rule.evidence, /ENOENT/)
})

test('frequent user corrections are critical and quote the user', () => {
  const { advice } = analyze([
    sample({ window: { corrections: ['不对'] } }),
    sample({ window: { corrections: ['还是不行'] } }),
    sample(),
  ])
  const rule = byId(advice, 'user-corrections')
  assert.ok(rule)
  assert.equal(rule.severity, 'critical')
  assert.match(rule.evidence, /不对/)
})

test('colliding skills and ignored loads surface as warnings', () => {
  const { advice } = analyze([
    sample({ window: { otherSkills: ['other-skill'], toolCalls: 0 } }),
    sample({ window: { otherSkills: ['other-skill'], toolCalls: 0 } }),
    sample(),
  ])
  const ids = advice.map((a) => a.id)
  assert.ok(ids.includes('trigger-collision'), ids.join(','))
  assert.ok(ids.includes('dead-load'), ids.join(','))
})

test('a stub skill produces authoring advice with fix instructions', () => {
  const stub = { ...GOOD_SKILL, description: 'pdf', whenToUse: undefined }
  const sp = staticProfile(stub, { content: '# todo\n\nTODO write me\n' })
  const { advice } = analyze([sample()], sp)
  const ids = advice.map((a) => a.id)
  assert.ok(ids.includes('placeholder-text'), ids.join(','))
  assert.ok(ids.includes('no-example'), ids.join(','))
  assert.ok(ids.includes('weak-description'), ids.join(','))
  for (const item of advice) {
    assert.ok(item.evidence.length > 0, item.id)
    assert.ok(item.fix.length > 0, item.id)
  }
})

test('low sample count is reported but never blocks the score', () => {
  const { advice, score } = analyze([sample()])
  assert.ok(advice.some((a) => a.id === 'low-sample'))
  assert.equal(score.provisional, true)
})

test('advice is ordered critical before warning before info', () => {
  const { advice } = analyze([
    sample({ ok: false, error: 'x', window: null }),
    sample({ ok: false, error: 'x', window: null }),
    sample({ ok: false, error: 'x', window: null }),
    sample({ window: { toolCalls: 0 } }),
    sample({ window: { toolCalls: 0 } }),
  ])
  const order = { critical: 0, warning: 1, info: 2 }
  for (let i = 1; i < advice.length; i += 1) {
    assert.ok(order[advice[i - 1].severity] <= order[advice[i].severity])
  }
  assert.equal(topAdvice(advice, 1).length, 1)
})

test('summary markdown renders one row per skill and the top fixes', () => {
  const sp = staticProfile(GOOD_SKILL, { content: GOOD_BODY })
  const { stats, score, advice } = analyze(
    [sample({ window: { corrections: ['不对'] } }), sample({ window: { corrections: ['还是不行'] } }), sample()],
    sp,
  )
  const md = renderSummaryMarkdown(
    partial<Report>({
      generatedAt: '2026-01-01T00:00:00.000Z',
      dataDir: '/tmp/x',
      totals: { invocations: 3, skills: 1, closed: 3, open: 0 },
      skills: [{ skill: 'pdf-tools', stats, score, advice, topAdvice: topAdvice(advice, 3) }],
    }),
  )
  assert.match(md, /pdf-tools/)
  assert.match(md, /Highest-value fixes/)
})

test('single-skill markdown shows dimensions and measured stats', () => {
  const sp = staticProfile(GOOD_SKILL, { content: GOOD_BODY })
  const { stats, score, advice } = analyze([sample(), sample(), sample()], sp)
  const md = renderSkillMarkdown(partial<SkillEntry>({ skill: 'pdf-tools', stats, score, advice, staticQuality: sp }))
  assert.match(md, /reliability/)
  assert.match(md, /median load time/)
})

test('dashboard HTML escapes skill names and user text', () => {
  const sp = staticProfile(GOOD_SKILL, { content: GOOD_BODY })
  const { stats, score, advice } = analyze([sample({ window: { corrections: ['<script>x</script>'] } })], sp)
  const html = renderHtml(
    partial<Report>({
      generatedAt: '2026-01-01T00:00:00.000Z',
      dataDir: '/tmp/x',
      totals: { invocations: 1, skills: 1, closed: 1, open: 0 },
      skills: [
        {
          skill: '<img onerror=alert(1)>',
          stats,
          score,
          advice,
          topAdvice: advice,
        },
      ],
    }),
  )
  assert.equal(html.includes('<img onerror'), false)
  assert.match(html, /&lt;img onerror/)
  assert.match(html, /<!doctype html>/)
})

test('an empty report still renders a usable dashboard', () => {
  const html = renderHtml(
    partial<Report>({
      generatedAt: '2026-01-01T00:00:00.000Z',
      dataDir: '/tmp/x',
      totals: { invocations: 0, skills: 0, closed: 0, open: 0 },
      skills: [],
    }),
  )
  assert.match(html, /No skill loads recorded yet/)
})

test('a loop that breaks after the load yields a critical rule naming the error', () => {
  const { advice } = analyze([
    sample({ window: { loopErrors: 1, lastLoopError: 'TypeError' } }),
    sample({ window: { loopErrors: 1, lastLoopError: 'TypeError' } }),
    sample(),
  ])
  const rule = byId(advice, 'loop-errors')
  assert.ok(rule)
  assert.equal(rule.severity, 'critical')
  assert.match(rule.evidence, /TypeError/)
})

test('heavy model-request retries yield a warning rule', () => {
  const { advice } = analyze([
    sample({ window: { llmRetries: 3 } }),
    sample({ window: { llmRetries: 3 } }),
    sample({ window: { llmRetries: 3 } }),
  ])
  assert.ok(advice.some((a) => a.id === 'llm-retries'))
})

test('MCP advice flags flaky, slow and broken tools', () => {
  const advice = buildMcpAdvice([
    {
      server: 'context7',
      calls: 10,
      errors: 4,
      errorRate: 0.4,
      p50Ms: 900,
      p95Ms: 4200,
      tools: [{ tool: 'query-docs', calls: 5, errors: 3 }],
    },
    { server: 'fetch', calls: 4, errors: 0, errorRate: 0, p50Ms: 200, p95Ms: 380, tools: [] },
  ])
  const ids = advice.map((item) => item.id)
  assert.ok(ids.includes('mcp-server-errors'))
  assert.ok(ids.includes('mcp-server-slow'))
  assert.ok(ids.includes('mcp-tool-errors'))
  assert.equal(advice.filter((item) => item.server === 'fetch').length, 0)
  // critical rules sort before warnings
  assert.equal(advice[0].severity, 'critical')
  for (const item of advice) {
    assert.ok(item.evidence.length > 0, item.id)
    assert.ok(item.fix.length > 0, item.id)
  }
})

test('a healthy MCP board produces no advice', () => {
  assert.deepEqual(
    buildMcpAdvice([
      {
        server: 'time',
        calls: 3,
        errors: 0,
        errorRate: 0,
        p50Ms: 120,
        p95Ms: 300,
        tools: [{ tool: 'now', calls: 3, errors: 0 }],
      },
    ]),
    [],
  )
  assert.deepEqual(buildMcpAdvice(undefined), [])
})

test('MCP thresholds are configurable per deployment', () => {
  const board = [
    {
      server: 'ctx',
      calls: 10,
      errors: 2,
      errorRate: 0.2,
      p50Ms: 500,
      p95Ms: 2000,
      tools: [{ tool: 'q', calls: 4, errors: 1 }],
    },
  ]
  // defaults tolerate 20% errors and 2s p95
  assert.deepEqual(buildMcpAdvice(board), [])
  // a stricter deployment flags the same data
  const strict = buildMcpAdvice(board, { errorRate: 0.1, p95Ms: 1000, toolErrorRate: 0.2 })
  assert.deepEqual(strict.map((item) => item.id).sort(), ['mcp-server-errors', 'mcp-server-slow', 'mcp-tool-errors'])
})

test('the noise floor downgrades a rate that is not outside its interval yet', () => {
  // 2 of 3 windows corrected: mean 67% > 30%, but the bootstrap low end is 0%
  const windows = [{ corrections: ['不对'] }, { corrections: ['错了'] }, { corrections: [] }]
  const samples = windows.map((w) =>
    sample({ window: { ...w, toolCalls: 3, errors: 0, errorNames: [], otherSkills: [], turnEnded: true } }),
  )
  const stats = aggregate(samples)
  const gatedAdvice = buildAdvice({ stats, static: null, score: { dimensions: {} }, minSamples: 3, windows })
  const rule = byId(gatedAdvice, 'user-corrections')
  assert.ok(rule, 'rule should still be reported')
  assert.equal(rule.severity, 'info')
  assert.match(rule.evidence, /not outside noise yet/)
})

test('the noise floor keeps critical when the interval clears the threshold', () => {
  // 9 of 10 windows corrected with n>=8: the capped gate can still report
  // strong, so the rule keeps its critical severity with no noise caveat.
  const windows = [
    { corrections: ['不对'] },
    { corrections: ['错了'] },
    { corrections: ['还是不行'] },
    { corrections: ['不对'] },
    { corrections: ['错了'] },
    { corrections: ['不行'] },
    { corrections: ['不对'] },
    { corrections: ['错了'] },
    { corrections: ['还是不对'] },
    { corrections: [] },
  ]
  const samples = windows.map((w) =>
    sample({ window: { ...w, toolCalls: 3, errors: 0, errorNames: [], otherSkills: [], turnEnded: true } }),
  )
  const stats = aggregate(samples)
  const advice = buildAdvice({ stats, static: null, score: { dimensions: {} }, minSamples: 3, windows })
  const rule = byId(advice, 'user-corrections')
  assert.equal(rule.severity, 'critical')
  assert.equal(rule.evidence.includes('not outside noise yet'), false)
  // gating can be switched off entirely
  const ungated = buildAdvice({ stats, static: null, score: { dimensions: {} }, minSamples: 3, windows, gating: false })
  assert.equal(byId(ungated, 'user-corrections').severity, 'critical')
})

test('the error-rate noise floor resamples calls, not windows', () => {
  const windows = [{ toolCalls: 40, errors: 20 }, ...Array.from({ length: 9 }, () => ({ toolCalls: 1, errors: 0 }))]
  const samples = windows.map((w) =>
    sample({ window: { ...w, errorNames: [], corrections: [], otherSkills: [], turnEnded: true } }),
  )
  const stats = aggregate(samples)
  assert.ok(Number(stats.errRate) > 0.4)
  const advice = buildAdvice({ stats, static: null, score: { dimensions: {} }, minSamples: 3, windows })
  const rule = byId(advice, 'post-load-errors')
  assert.ok(rule, 'a 41% call error rate must not be hidden by the window hit-rate gate')
  assert.match(rule.evidence, /41%/)
})

test('expensive loads produce a token-cost warning', () => {
  const windows = [1, 2, 3].map(() => ({
    toolCalls: 4,
    errors: 0,
    errorNames: [],
    corrections: [],
    otherSkills: [],
    turnEnded: true,
    tokens: { input: 60000, output: 10000, cacheRead: 0, calls: 3 },
  }))
  const samples = windows.map((w) => sample({ window: w }))
  const stats = aggregate(samples)
  const advice = buildAdvice({
    stats,
    static: null,
    score: { dimensions: {} },
    minSamples: 3,
    windows,
    tokenBudgetPerLoad: 20000,
  })
  const rule = byId(advice, 'token-cost')
  assert.ok(rule, advice.map((item) => item.id).join(','))
  assert.match(rule.evidence, /billable tokens per load/)
})

test('a consistently low-scoring, well-sampled skill becomes a prune candidate', () => {
  const windows = Array.from({ length: 8 }, () => ({
    toolCalls: 2,
    errors: 1,
    errorNames: ['E'],
    corrections: ['不对'],
    otherSkills: [],
    turnEnded: true,
  }))
  const samples = windows.map((w) => sample({ window: w }))
  const stats = aggregate(samples)
  const score = { total: 41, ci: { low: 33, high: 49 }, dimensions: {} }
  const advice = buildAdvice({ stats, static: null, score, minSamples: 3, windows })
  const rule = byId(advice, 'prune-candidate')
  assert.ok(rule, advice.map((item) => item.id).join(','))
  assert.equal(rule.severity, 'critical')

  // well-sampled but healthy stays quiet
  const healthy = buildAdvice({
    stats,
    static: null,
    score: { total: 85, ci: { low: 80, high: 90 }, dimensions: {} },
    minSamples: 3,
    windows,
  })
  assert.equal(
    healthy.some((item) => item.id === 'prune-candidate'),
    false,
  )
})

test('a slow MCP tool gets its own warning with latency evidence', () => {
  const servers = [
    {
      server: 'context7',
      calls: 4,
      errors: 0,
      errorRate: 0,
      p50Ms: 120,
      p95Ms: 300,
      tools: [{ tool: 'query-docs', calls: 3, errors: 0, errorRate: 0, p50Ms: 4000, p95Ms: 9000 }],
    },
  ]
  const advice = buildMcpAdvice(servers, { toolP95Ms: 5000 })
  const rule = byId(advice, 'mcp-tool-slow')
  assert.ok(rule, advice.map((item) => item.id).join(','))
  assert.match(rule.evidence, /p95 9000ms/)
  assert.match(rule.title, /context7\/query-docs/)
  // a permissive threshold silences it, and a single call is not enough evidence
  assert.equal(
    buildMcpAdvice(servers, { toolP95Ms: 0 }).some((item) => item.id === 'mcp-tool-slow'),
    false,
  )
  assert.equal(buildMcpAdvice(servers, { toolP95Ms: 5000 }).length, 1)
  const single = [
    { ...servers[0], tools: [{ tool: 'query-docs', calls: 1, errors: 0, errorRate: 0, p50Ms: 9000, p95Ms: 9000 }] },
  ]
  assert.equal(
    buildMcpAdvice(single, { toolP95Ms: 5000 }).some((item) => item.id === 'mcp-tool-slow'),
    false,
  )
})

test('MCP tool advice fills the tool name into the Chinese title', () => {
  const advice = buildMcpAdvice([
    {
      server: 'gh',
      calls: 4,
      errors: 4,
      errorRate: 1,
      tools: [{ tool: 'search', calls: 4, errors: 4, p95Ms: 9000 }],
    },
  ])
  const toolRules = advice.filter((item) => item.id === 'mcp-tool-errors' || item.id === 'mcp-tool-slow')
  assert.equal(toolRules.length, 2)
  for (const item of toolRules) assert.match(String(item.titleZh), /gh\/search/, item.id)
})

test('the dead-load gate resamples the same root windows the rate is judged on', () => {
  const windows = [
    { toolCalls: 0, origin: null },
    { toolCalls: 3, origin: null },
    { toolCalls: 3, origin: null },
    ...Array.from({ length: 27 }, () => ({ toolCalls: 0, origin: 'subagent' })),
  ]
  const samples = windows.map((w) =>
    sample({ window: { errors: 0, errorNames: [], corrections: [], otherSkills: [], turnEnded: true, ...w } }),
  )
  const stats = aggregate(samples)
  assert.ok(Number(stats.abandonRate) > 0.3)
  const advice = buildAdvice({ stats, static: null, score: { dimensions: {} }, minSamples: 3, windows })
  const rule = byId(advice, 'dead-load')
  assert.ok(rule === undefined || rule.severity !== 'warning')
})
