import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_WEIGHTS,
  bootstrapRate,
  aggregate,
  gradeOf,
  isCorrection,
  median,
  scoreSkill,
  staticProfile,
} from '../lib/score.js'

const GOOD_SKILL = {
  name: 'pdf-tools',
  description:
    'Use when the user needs to extract, split, merge or annotate PDF files: read page text, reorder pages, fill forms, and export to images.',
  whenToUse: 'Any task whose input or output is a .pdf file.',
  path: '/Users/adams/.dsh/skills/pdf-tools/SKILL.md',
  invocation: { modelInvocable: true, userInvocable: true },
  source: 'user-dsh',
  provider: 'filesystem',
  resourceBase: '/Users/adams/.dsh/skills/pdf-tools',
}

const GOOD_BODY = `---
name: pdf-tools
description: pdf tooling
---

# PDF tools

## When to use

Use when the input is a PDF.

## Steps

1. Inspect the file with \`scripts/inspect.py\`.
2. Load \`references/forms.md\` only when a form must be filled.

\`\`\`bash
python scripts/inspect.py input.pdf
\`\`\`

See references/forms.md for form field details.
`

const BAD_BODY = `# stuff

TODO: write this later
`

test('gradeOf maps total to the documented bands', () => {
  assert.equal(gradeOf(95), 'A')
  assert.equal(gradeOf(90), 'A')
  assert.equal(gradeOf(89), 'B')
  assert.equal(gradeOf(80), 'B')
  assert.equal(gradeOf(79), 'C')
  assert.equal(gradeOf(70), 'C')
  assert.equal(gradeOf(69), 'D')
  assert.equal(gradeOf(60), 'D')
  assert.equal(gradeOf(59), 'F')
  assert.equal(gradeOf(null), '?')
})

test('median handles empty and odd/even inputs', () => {
  assert.equal(median([]), null)
  assert.equal(median([5]), 5)
  assert.equal(median([1, 3, 9]), 3)
  assert.equal(median([1, 3, 9, 11]), 6)
})

test('isCorrection recognises Chinese and English pushback', () => {
  for (const text of ['不对，应该用另一种方式', '重做一遍', '还是不行', 'wrong format', "no, that's not right"]) {
    assert.equal(isCorrection(text), true, text)
  }
  for (const text of ['ok thanks', '继续', 'please extract page 3', '重新排序这些页面', 'run it again on page 4']) {
    assert.equal(isCorrection(text), false, text)
  }
})

test('a well-authored skill scores high on static checks', () => {
  const profile = staticProfile(GOOD_SKILL, { content: GOOD_BODY })
  assert.ok(profile.score >= 80, `expected >= 80, got ${profile.score}`)
  assert.equal(profile.failedChecks.length <= 2, true)
})

test('a stub skill scores low and reports the failing checks', () => {
  const stub = { ...GOOD_SKILL, description: 'pdf', whenToUse: undefined }
  const profile = staticProfile(stub, { content: BAD_BODY })
  assert.ok(profile.score <= 55, `expected <= 55, got ${profile.score}`)
  const ids = profile.failedChecks.map((c) => c.id)
  assert.ok(ids.includes('body-present') || ids.includes('desc-length'), ids.join(','))
  assert.ok(ids.includes('no-placeholder'), ids.join(','))
})

test('staticProfile tolerates a missing definition', () => {
  const profile = staticProfile(GOOD_SKILL, undefined)
  assert.equal(typeof profile.score, 'number')
})

function sample(overrides = {}) {
  return {
    at: Date.now(),
    ok: true,
    loadMs: 120,
    window: {
      toolCalls: 4,
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

test('aggregate derives the rates used by scoring', () => {
  const stats = aggregate([
    sample(),
    sample({ window: { toolCalls: 6, errors: 3, errorNames: ['BashError', 'BashError', 'BashError'] } }),
    sample({ ok: false, error: 'load failed', window: null }),
    sample({ window: { toolCalls: 0, errors: 0, corrections: ['不对'] } }),
  ])
  assert.equal(stats.loads, 4)
  assert.equal(stats.closed, 3)
  assert.equal(stats.loadOkRate, 0.75)
  assert.equal(stats.correctionRate, 1 / 3)
  assert.equal(stats.errRate, 3 / 10)
  assert.equal(stats.abandonRate, 1 / 3)
  assert.deepEqual({ ...stats.errorNames }, { BashError: 3 })
})

test('aggregate with no evidence yields null rates instead of NaN', () => {
  const stats = aggregate([])
  assert.equal(stats.loads, 0)
  assert.equal(stats.errRate, null)
  assert.equal(stats.correctionRate, null)
  assert.equal(stats.avgCalls, null)
})

test('scoreSkill renormalises weights when a dimension has no evidence', () => {
  const stats = aggregate([sample()])
  const staticOnly = staticProfile(GOOD_SKILL, { content: GOOD_BODY })
  const score = scoreSkill({ stats, static: staticOnly, weights: DEFAULT_WEIGHTS, minSamples: 3 })
  assert.equal(score.provisional, true)
  const sum = Object.values(score.effectiveWeights).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}`)
  assert.ok(score.total >= 0 && score.total <= 100)
})

test('a skill with only failures cannot score well', () => {
  const stats = aggregate([
    sample({ ok: false, error: 'boom', window: null }),
    sample({ ok: false, error: 'boom', window: null }),
    sample({ ok: false, error: 'boom', window: null }),
  ])
  const score = scoreSkill({ stats, static: null, weights: DEFAULT_WEIGHTS, minSamples: 3 })
  assert.ok(score.dimensions.reliability < 30, String(score.dimensions.reliability))
  assert.ok(score.dimensions.static === null)
})

test('loop errors after a load reduce reliability, tool errors reduce it more', () => {
  const clean = aggregate([sample(), sample(), sample()])
  const loopBroken = aggregate([
    sample({ window: { loopErrors: 1, lastLoopError: 'TypeError' } }),
    sample({ window: { loopErrors: 1, lastLoopError: 'TypeError' } }),
    sample(),
  ])
  assert.equal(clean.loopErrorRate, 0)
  assert.equal(loopBroken.loopErrorRate, 2 / 3)
  assert.deepEqual({ ...loopBroken.loopErrorNames }, { TypeError: 2 })
  const cleanScore = scoreSkill({ stats: clean, static: null, minSamples: 3 })
  const brokenScore = scoreSkill({ stats: loopBroken, static: null, minSamples: 3 })
  assert.equal(cleanScore.dimensions.reliability, 100)
  assert.ok(brokenScore.dimensions.reliability < cleanScore.dimensions.reliability)
  assert.ok(brokenScore.dimensions.reliability > 50, String(brokenScore.dimensions.reliability))
})

test('retried model requests are aggregated too', () => {
  const stats = aggregate([sample({ window: { llmRetries: 2 } }), sample({ window: { llmRetries: 2 } })])
  assert.equal(stats.llmRetries, 4)
})

test('each dimension responds only to its own signal (score sensitivity)', () => {
  const sp = staticProfile(GOOD_SKILL, { content: GOOD_BODY })
  const base = aggregate([sample(), sample(), sample()])
  const baseScore = scoreSkill({ stats: base, static: sp, minSamples: 3 })

  const errors = aggregate([
    sample({ window: { toolCalls: 8, errors: 4, errorNames: ['E', 'E', 'E', 'E'] } }),
    sample({ window: { toolCalls: 8, errors: 4, errorNames: ['E', 'E', 'E', 'E'] } }),
    sample({ window: { toolCalls: 8, errors: 4, errorNames: ['E', 'E', 'E', 'E'] } }),
  ])
  const errorScore = scoreSkill({ stats: errors, static: sp, minSamples: 3 })
  assert.ok(errorScore.dimensions.reliability < baseScore.dimensions.reliability)
  assert.equal(errorScore.dimensions.static, baseScore.dimensions.static)

  const corrected = aggregate([
    sample({ window: { corrections: ['不对'] } }),
    sample({ window: { corrections: ['还是不行'] } }),
    sample({ window: { corrections: ['错了'] } }),
  ])
  const correctedScore = scoreSkill({ stats: corrected, static: sp, minSamples: 3 })
  assert.ok(correctedScore.dimensions.effectiveness < baseScore.dimensions.effectiveness)
  assert.equal(correctedScore.dimensions.reliability, baseScore.dimensions.reliability)

  const expensive = aggregate([
    sample({ window: { toolCalls: 20 }, loadMs: 9000 }),
    sample({ window: { toolCalls: 20 }, loadMs: 9000 }),
    sample({ window: { toolCalls: 20 }, loadMs: 9000 }),
  ])
  const expensiveScore = scoreSkill({ stats: expensive, static: sp, minSamples: 3 })
  assert.ok(expensiveScore.dimensions.efficiency < baseScore.dimensions.efficiency)
  assert.ok(expensiveScore.dimensions.effectiveness >= baseScore.dimensions.effectiveness - 10)

  // and the composite moves with the evidence it is made of
  assert.ok(errorScore.total < baseScore.total)
  assert.ok(correctedScore.total < baseScore.total)
  assert.ok(expensiveScore.total < baseScore.total)
})

test('a broken load path cannot be rescued by a beautiful skill body', () => {
  const sp = staticProfile(GOOD_SKILL, { content: GOOD_BODY })
  const stats = aggregate([
    sample({ ok: false, error: 'ENOENT', window: null }),
    sample({ ok: false, error: 'ENOENT', window: null }),
    sample({ ok: false, error: 'ENOENT', window: null }),
  ])
  const score = scoreSkill({ stats, static: sp, minSamples: 3 })
  assert.equal(score.dimensions.reliability, 0)
  assert.ok(score.total < 60, String(score.total))
})

test('abandonment is judged on root runs, not on short subagent runs', () => {
  const rootOnly = aggregate([
    sample({ window: { toolCalls: 0, origin: null } }),
    sample({ window: { toolCalls: 3, origin: null } }),
  ])
  assert.equal(rootOnly.abandonRate, 0.5)
  assert.equal(rootOnly.abandonBase, 2)

  const withSubagents = aggregate([
    sample({ window: { toolCalls: 0, origin: null } }),
    sample({ window: { toolCalls: 3, origin: null } }),
    sample({ window: { toolCalls: 0, origin: 'subagent' } }),
    sample({ window: { toolCalls: 0, origin: 'subagent' } }),
  ])
  // the two subagent loads must not inflate the root abandonment signal
  assert.equal(withSubagents.abandonRate, 0.5)
  assert.equal(withSubagents.abandonBase, 2)

  const subagentOnly = aggregate([
    sample({ window: { toolCalls: 0, origin: 'subagent' } }),
    sample({ window: { toolCalls: 1, origin: 'subagent' } }),
  ])
  assert.equal(subagentOnly.abandonRate, 0.5)
})

test('known archetypes land in the expected grade bands (calibration)', () => {
  const honest = staticProfile(GOOD_SKILL, { content: GOOD_BODY })
  const sloppy = staticProfile({ ...GOOD_SKILL, description: 'pdf', whenToUse: undefined }, { content: BAD_BODY })

  const healthy = aggregate([sample(), sample(), sample(), sample()])
  const mediocre = aggregate([
    sample({ window: { toolCalls: 6, errors: 1, errorNames: ['E'], corrections: ['不对'] } }),
    sample({ window: { toolCalls: 6, errors: 1, errorNames: ['E'] } }),
    sample({ window: { toolCalls: 6, errors: 1, errorNames: ['E'] } }),
    sample({ window: { toolCalls: 6, errors: 1, errorNames: ['E'] } }),
  ])
  const broken = aggregate([
    sample({ ok: false, error: 'ENOENT', window: null }),
    sample({ ok: false, error: 'ENOENT', window: null }),
    sample({ ok: false, error: 'ENOENT', window: null }),
    sample({ ok: false, error: 'ENOENT', window: null }),
  ])

  const a = scoreSkill({ stats: healthy, static: honest, minSamples: 3 })
  const b = scoreSkill({ stats: mediocre, static: sloppy, minSamples: 3 })
  const f = scoreSkill({ stats: broken, static: honest, minSamples: 3 })

  assert.equal(a.grade, 'A')
  assert.ok(['C', 'D'].includes(b.grade), `mediocre was ${b.grade} (${b.total})`)
  assert.equal(f.grade, 'F')
  assert.ok(a.total > b.total && b.total > f.total, `${a.total} / ${b.total} / ${f.total}`)
  assert.equal(a.confidence, 'medium')
})

test('measured tokens per load feed the efficiency dimension', () => {
  const windows = (tokens) =>
    [1, 2, 3].map(() => ({
      at: 1,
      ok: true,
      loadMs: 100,
      window: { toolCalls: 4, errors: 0, errorNames: [], corrections: [], otherSkills: [], turnEnded: true, tokens },
    }))
  const cheap = aggregate(windows({ input: 1000, output: 500, cacheRead: 0, calls: 2 }))
  const pricey = aggregate(windows({ input: 50000, output: 20000, cacheRead: 100000, calls: 2 }))
  assert.equal(cheap.tokensPerLoad, 1500)
  assert.equal(pricey.tokensPerLoad > cheap.tokensPerLoad, true)
  const cheapScore = scoreSkill({ stats: cheap, static: null, minSamples: 1 })
  const priceyScore = scoreSkill({ stats: pricey, static: null, minSamples: 1 })
  assert.ok(priceyScore.dimensions.efficiency < cheapScore.dimensions.efficiency)
  // the budget is configurable
  const lenient = scoreSkill({ stats: pricey, static: null, minSamples: 1, tokenBudgetPerLoad: 10_000_000 })
  assert.ok(lenient.dimensions.efficiency > priceyScore.dimensions.efficiency)
})

test('bootstrapRate brackets a rate and stays reproducible', () => {
  const windows = [{ c: 1 }, { c: 0 }, { c: 1 }, { c: 0 }]
  const ci = bootstrapRate(windows, (w) => w.c === 1, { resamples: 300, seed: 3 })
  assert.equal(ci.mean, 0.5)
  assert.ok(ci.low <= 0.5 && ci.high >= 0.5)
  assert.deepEqual(
    ci,
    bootstrapRate(windows, (w) => w.c === 1, { resamples: 300, seed: 3 }),
  )
  assert.equal(
    bootstrapRate([{ c: 1 }], () => true),
    null,
  )
})

test('tokens per load only divides by windows that actually carried usage', () => {
  const withTokens = {
    at: 1,
    ok: true,
    loadMs: 100,
    window: {
      toolCalls: 2,
      errors: 0,
      corrections: [],
      otherSkills: [],
      turnEnded: true,
      tokens: { input: 1200, output: 300, cacheRead: 0, calls: 1 },
    },
  }
  const legacy = {
    at: 2,
    ok: true,
    loadMs: 100,
    window: { toolCalls: 2, errors: 0, corrections: [], otherSkills: [], turnEnded: true },
  }
  const stats = aggregate([withTokens, legacy])
  assert.equal(stats.tokenWindows, 1)
  assert.equal(stats.tokensPerLoad, 1500)
  const cheap = aggregate([withTokens])
  assert.equal(cheap.tokensPerLoad, 1500)
})
