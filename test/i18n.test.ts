import test from 'node:test'
import assert from 'node:assert/strict'
import { renderHtml, resolveLang } from '../src/lib/render.ts'
import { renderConfigHtml } from '../src/lib/settings.ts'
import type { Report } from '../src/lib/report.ts'
import { partial } from './helpers.ts'

const REPORT = partial<Report>({
  generatedAt: '2026-11-15T00:00:00.000Z',
  dataDir: '/data',
  totals: { invocations: 3, skills: 2, closed: 2, open: 1, storeError: null },
  scoring: {
    weightsPercent: { static: 30, reliability: 25, effectiveness: 30, efficiency: 15 },
    thresholds: { excellent: 90, good: 80, pass: 70 },
  },
  ranking: { significant: false },
  validity: {
    coverage: { skills: 2, withCI: 1, provisional: 1, actionable: 1, explorable: 0 },
    ranking: { significant: false },
    canSay: ['scores for 2 skill(s)'],
    cannotSay: ['1 skill has no interval yet'],
  },
  edits: [
    {
      at: 1_700_000_000_000,
      skill: 'pdf-tools',
      dimension: 'static',
      verdict: 'accept',
      hypothesis: 'sharpen triggers',
    },
  ],
  mcpServers: [
    { server: 'context7', health: 88, grade: 'B', calls: 3, errors: 0, errorRate: 0, p50Ms: 100, p95Ms: 200 },
  ],
  mcpAdvice: [],
  runs: [
    {
      sessionId: 'session-abcdef',
      score: { total: 80, grade: 'B' },
      loads: 2,
      toolCalls: 5,
      errors: 0,
      corrections: 0,
      skills: ['pdf-tools'],
    },
  ],
  skills: [
    {
      skill: 'pdf-tools',
      score: {
        total: 80,
        grade: 'B',
        provisional: false,
        dimensions: { static: 80, reliability: 90, effectiveness: 85, efficiency: 95 },
      },
      stats: { loads: 2, closed: 2, correctionRate: 0, abandonRate: 0, errRate: 0, p50LoadMs: 90 },
      advice: [],
    },
  ],
})

test('language resolution: explicit wins, then Accept-Language, then English', () => {
  assert.equal(resolveLang('zh-CN,zh;q=0.9', null), 'zh')
  assert.equal(resolveLang('en-US,en;q=0.9', null), 'en')
  assert.equal(resolveLang('zh-CN', 'en'), 'en')
  assert.equal(resolveLang('en-US', 'zh'), 'zh')
  assert.equal(resolveLang(undefined, undefined), 'en')
  assert.equal(resolveLang('fr-FR', undefined), 'en')
})

test('the board renders Chinese chrome when asked', () => {
  const zh = renderHtml(REPORT, { lang: 'zh', base: '/skill-eval' })
  assert.match(zh, /<html lang="zh">/)
  for (const needle of [
    '技能执行报告',
    '下一步（按预期收益',
    '证据能支持什么',
    '可以断言',
    '已审查的改动',
    'MCP 服务器',
    '最近运行',
    '静态质量',
    '可靠性',
  ]) {
    assert.ok(zh.includes(needle), `missing ${needle}`)
  }
  assert.match(zh, /href="\/skill-eval\/config"/)
  assert.match(zh, /href="\?lang=en"/)
})

test('advice copy follows the board language', () => {
  const report = partial<Report>({
    ...REPORT,
    skills: [
      {
        ...REPORT.skills[0],
        advice: [
          {
            id: 'token-cost',
            severity: 'warning',
            dimension: 'efficiency',
            title: 'Loading this skill is expensive in policy tokens',
            titleZh: '加载该技能占用的策略 token 过多',
            evidence: '12 loads above the budget',
            fix: 'Trim the body.',
            fixZh: '精简正文。',
          },
        ],
      },
    ],
  })
  const zh = renderHtml(report, { lang: 'zh', base: '/skill-eval' })
  assert.match(zh, /加载该技能占用的策略 token 过多/)
  assert.match(zh, /精简正文/)
  assert.equal(zh.includes('Loading this skill is expensive'), false)
  const en = renderHtml(report, { base: '/skill-eval' })
  assert.match(en, /Loading this skill is expensive in policy tokens/)
  assert.match(en, /Trim the body\./)
})

test('ranking and validity statements follow the board language', () => {
  const report = partial<Report>({
    ...REPORT,
    ranking: { significant: false, note: 'rank is not significant: "a" and "b"', noteZh: '排名不显著：“a”与“b”' },
    validity: {
      ...REPORT.validity,
      canSay: ['scores for 2 skill(s)'],
      canSayZh: ['2 个技能的分数'],
      cannotSay: ['too few skills'],
      cannotSayZh: ['技能太少'],
    },
  })
  const zh = renderHtml(report, { lang: 'zh', base: '/skill-eval' })
  assert.match(zh, /2 个技能的分数/)
  assert.match(zh, /技能太少/)
  assert.equal(zh.includes('scores for 2 skill(s)'), false)
  const en = renderHtml(report, { base: '/skill-eval' })
  assert.match(en, /scores for 2 skill\(s\)/)
})

test('the board renders English chrome by default', () => {
  const en = renderHtml(REPORT, { base: '/skill-eval' })
  assert.match(en, /<html lang="en">/)
  for (const needle of [
    'Skill execution report',
    'Next steps',
    'What the evidence supports',
    'Can say',
    'Screened edits',
    'MCP servers',
    'Recent runs',
  ]) {
    assert.ok(en.includes(needle), `missing ${needle}`)
  }
  assert.match(en, /href="\?lang=zh"/)
})

test('the settings page is bilingual too', () => {
  const config = {
    weights: { static: 30, reliability: 25, effectiveness: 30, efficiency: 15 },
    minSamples: 3,
    adviceNoiseFloor: true,
  }
  const zh = renderConfigHtml({ config, base: '/skill-eval', lang: 'zh' })
  assert.match(zh, /技能评测 · 配置/)
  assert.match(zh, /权重：静态质量/)
  assert.match(zh, /保存/)
  assert.match(zh, /href="\?lang=en"/)
  const en = renderConfigHtml({ config, base: '/skill-eval', lang: 'en' })
  assert.match(en, /Skill eval · Config/)
  assert.match(en, /weight: static/)
  assert.match(en, />Save</)
})
