import test from 'node:test'
import assert from 'node:assert/strict'
import { CORPUS } from './corpus/skills.mjs'
import { buildAdvice } from '../lib/advice.js'
import { aggregate, scoreSkill, staticProfile } from '../lib/score.js'

function evaluate(entry) {
  const profile = staticProfile(entry.skill, { content: entry.content })
  const stats = aggregate([])
  const score = scoreSkill({ stats, static: profile, minSamples: 3 })
  const advice = buildAdvice({ stats, static: profile, score, minSamples: 3 })
  return { profile, score, advice }
}

test('every corpus pattern is evaluated with the expected verdict', () => {
  for (const entry of CORPUS) {
    const { profile, score } = evaluate(entry)
    assert.ok(profile, `${entry.id}: static profile missing`)
    if (typeof entry.expect.minScore === 'number') {
      assert.ok(
        profile.score >= entry.expect.minScore,
        `${entry.id}: static ${profile.score} < ${entry.expect.minScore}`,
      )
    }
    if (typeof entry.expect.maxScore === 'number') {
      assert.ok(
        profile.score <= entry.expect.maxScore,
        `${entry.id}: static ${profile.score} > ${entry.expect.maxScore}`,
      )
    }
    const failedIds = profile.failedChecks.map((check) => check.id)
    for (const id of entry.expect.failedCheckIds) {
      assert.ok(failedIds.includes(id), `${entry.id}: expected ${id} to fail, got ${failedIds.join(',')}`)
    }
    assert.ok(score.total === null || (score.total >= 0 && score.total <= 100), `${entry.id}: score out of band`)
  }
})

test('the corpus tracks the known gaps instead of pretending they are covered', () => {
  const negative = CORPUS.find((entry) => entry.id === 'negative-trigger')
  assert.ok(negative.knownGap, 'negative-trigger must document its gap')
  const { profile } = evaluate(negative)
  // We do not penalise anti-trigger text today: if a check is added, update the corpus.
  assert.equal(
    profile.failedChecks.some((check) => /anti|negative|not-use/.test(check.id)),
    false,
  )

  const mcpDependent = CORPUS.find((entry) => entry.id === 'mcp-dependent')
  const mcpProfile = evaluate(mcpDependent).profile
  assert.equal(
    mcpProfile.failedChecks.some((check) => check.id === 'progressive-disclosure'),
    true,
  )
})

test('overlong and weak-trigger patterns produce actionable advice', () => {
  const overlong = CORPUS.find((entry) => entry.id === 'overlong-mono')
  const longAdvice = evaluate(overlong).advice.map((item) => item.id)
  assert.ok(longAdvice.includes('body-too-long'), longAdvice.join(','))

  const weak = CORPUS.find((entry) => entry.id === 'weak-trigger')
  const weakAdvice = evaluate(weak).advice.map((item) => item.id)
  assert.ok(weakAdvice.includes('weak-description'), weakAdvice.join(','))
})
