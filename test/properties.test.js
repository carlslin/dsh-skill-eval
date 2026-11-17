import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_WEIGHTS, aggregate, gradeOf, scoreSkill, staticProfile } from '../lib/score.js'
import { buildMcpAdvice, buildAdvice } from '../lib/advice.js'
import { bootstrapCI, normalizeWeights, rankingOf } from '../lib/report.js'

/** Deterministic RNG for property tests: a failure is always reproducible. */
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomSample(random) {
  const calls = Math.floor(random() * 15)
  const errors = calls === 0 ? 0 : Math.floor(random() * (calls + 1))
  const ok = random() > 0.15
  return {
    at: 1,
    ok,
    loadMs: Math.floor(random() * 5000),
    error: ok ? undefined : 'load failed',
    window:
      random() > 0.1
        ? {
            toolCalls: calls,
            errors,
            errorNames: errors > 0 ? Array.from({ length: errors }, () => 'E') : [],
            corrections: random() > 0.7 ? ['不对'] : [],
            otherSkills: random() > 0.85 ? ['other'] : [],
            loopErrors: random() > 0.9 ? 1 : 0,
            llmRetries: random() > 0.9 ? 2 : 0,
            turnEnded: true,
            truncated: false,
            origin: random() > 0.8 ? 'subagent' : null,
          }
        : null,
  }
}

const SKILL = {
  name: 'property-skill',
  description:
    'Use when the user needs a deterministic property-tested skill with enough description length to pass checks.',
  whenToUse: 'Property tests.',
  source: 'custom',
  provider: 'filesystem',
}
const BODY = '# Skill\n\n## Steps\n\n```bash\nx\n```\n\nSee references/a.md and scripts/b.sh.\n'

test('property: a score is always a bounded number whose grade matches its band', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const random = rng(seed)
    const samples = Array.from({ length: 1 + Math.floor(random() * 10) }, () => randomSample(random))
    const stats = aggregate(samples)
    const sp = staticProfile(SKILL, { content: BODY })
    const score = scoreSkill({ stats, static: sp, weights: DEFAULT_WEIGHTS, minSamples: 3 })
    assert.ok(score.total === null || (score.total >= 0 && score.total <= 100), `seed ${seed}: ${score.total}`)
    assert.equal(score.grade, gradeOf(score.total))
    for (const value of Object.values(score.dimensions)) {
      assert.ok(value === null || (value >= 0 && value <= 100), `seed ${seed}: ${value}`)
    }
    for (const value of [stats.loadOkRate, stats.errRate, stats.correctionRate, stats.abandonRate, stats.siblingRate]) {
      assert.ok(value === null || (value >= 0 && value <= 1), `seed ${seed}: ${value}`)
    }
  }
})

test('property: the confidence interval always contains the point estimate', () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const random = rng(seed * 7)
    const samples = Array.from({ length: 2 + Math.floor(random() * 8) }, () => randomSample(random))
    const stats = aggregate(samples)
    const score = scoreSkill({ stats, static: null, weights: DEFAULT_WEIGHTS, minSamples: 3 })
    const ci = bootstrapCI(
      samples,
      (draw) => scoreSkill({ stats: aggregate(draw), static: null, weights: DEFAULT_WEIGHTS, minSamples: 3 }).total,
      { resamples: 60, seed },
    )
    if (ci && score.total !== null) {
      assert.ok(
        ci.low <= score.total && ci.high >= score.total,
        `seed ${seed}: ${JSON.stringify(ci)} vs ${score.total}`,
      )
      assert.ok(ci.low <= ci.high)
    }
    // fewer than two loads can never produce an interval
    assert.equal(
      bootstrapCI(samples.slice(0, 1), () => 50, { resamples: 10 }),
      null,
    )
  }
})

test('property: one more tool error never raises reliability, one more correction never raises effectiveness', () => {
  const base = [
    {
      at: 1,
      ok: true,
      loadMs: 100,
      window: { toolCalls: 6, errors: 1, errorNames: ['E'], corrections: [], otherSkills: [], turnEnded: true },
    },
    {
      at: 2,
      ok: true,
      loadMs: 100,
      window: { toolCalls: 6, errors: 1, errorNames: ['E'], corrections: [], otherSkills: [], turnEnded: true },
    },
  ]
  const before = scoreSkill({ stats: aggregate(base), static: null, weights: DEFAULT_WEIGHTS, minSamples: 1 })
  const moreErrors = scoreSkill({
    stats: aggregate([...base, { at: 3, ok: true, loadMs: 100, window: { toolCalls: 1, errors: 1, turnEnded: true } }]),
    static: null,
    weights: DEFAULT_WEIGHTS,
    minSamples: 1,
  })
  assert.ok(moreErrors.dimensions.reliability <= before.dimensions.reliability)

  const corrected = scoreSkill({
    stats: aggregate([
      ...base,
      { at: 3, ok: true, loadMs: 100, window: { toolCalls: 1, errors: 0, corrections: ['不对'], turnEnded: true } },
    ]),
    static: null,
    weights: DEFAULT_WEIGHTS,
    minSamples: 1,
  })
  assert.ok(corrected.dimensions.effectiveness <= before.dimensions.effectiveness)
})

test('property: custom weights normalise and never leave the score out of band', () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const random = rng(seed * 13)
    const raw = {
      static: Math.floor(random() * 100),
      reliability: Math.floor(random() * 100),
      effectiveness: Math.floor(random() * 100),
      efficiency: Math.floor(random() * 100),
    }
    const weights = normalizeWeights(raw)
    const sum = Object.values(weights).reduce((a, b) => a + b, 0)
    assert.ok(Math.abs(sum - 1) < 0.01, `seed ${seed}: ${JSON.stringify(weights)}`)
    const stats = aggregate([randomSample(random), randomSample(random), randomSample(random)])
    const score = scoreSkill({ stats, static: staticProfile(SKILL, { content: BODY }), weights, minSamples: 1 })
    assert.ok(score.total === null || (score.total >= 0 && score.total <= 100))
  }
})

test('property: the ranking caveat appears exactly when adjacent intervals overlap closely', () => {
  const entry = (skill, total, low, high) => ({ skill, score: { total, ci: { low, high } } })
  assert.equal(rankingOf([entry('a', 90, 85, 95), entry('b', 88, 84, 92)]).significant, false)
  assert.equal(rankingOf([entry('a', 90, 85, 95), entry('b', 70, 60, 80)]).significant, true)
  assert.equal(rankingOf([entry('a', 90, 85, 95), entry('b', 88, 10, 20)]).significant, true)
  assert.equal(rankingOf([entry('a', 90, 85, 95)]).significant, null)
})

test('property: MCP advice appears exactly past the configured error-rate threshold', () => {
  const run = (errors) =>
    buildMcpAdvice([{ server: 's', calls: 10, errors, errorRate: errors / 10, p50Ms: 100, p95Ms: 200, tools: [] }], {
      errorRate: 0.2,
    })
  assert.equal(run(1).length, 0)
  assert.equal(run(5).length, 1)
  assert.equal(run(9).length, 1)
})

test('property: the same recorded evidence always yields the same score and advice', () => {
  const random = rng(99)
  const samples = Array.from({ length: 6 }, () => randomSample(random))
  const sp = staticProfile(SKILL, { content: BODY })
  const one = scoreSkill({ stats: aggregate(samples), static: sp, weights: DEFAULT_WEIGHTS, minSamples: 3 })
  const two = scoreSkill({ stats: aggregate(samples), static: sp, weights: DEFAULT_WEIGHTS, minSamples: 3 })
  assert.deepEqual(one, two)
  const adviceOne = buildAdvice({ stats: aggregate(samples), static: sp, score: one, minSamples: 3 })
  const adviceTwo = buildAdvice({ stats: aggregate(samples), static: sp, score: two, minSamples: 3 })
  assert.deepEqual(adviceOne, adviceTwo)
  assert.equal(
    adviceOne.every((item) => item.evidence.length > 0 && item.fix.length > 0),
    true,
  )
})
