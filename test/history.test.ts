import test from 'node:test'
import assert from 'node:assert/strict'
import { buildHistory, buildImpact, renderHistoryMarkdown, renderImpactMarkdown } from '../src/lib/history.ts'
import type { StoredRecord } from '../src/lib/types.ts'

const now = 1_700_000_000_000

function records(
  counts: Array<{ calls: number; errors: number; corrections?: number }>,
  failurePattern: number[] = [],
) {
  const list: StoredRecord[] = []
  counts.forEach(({ calls, errors, corrections = 0 }, index) => {
    const at = now + index * 1000
    const windowId = `s:c${index}`
    list.push({
      t: 'skill',
      at,
      sessionId: 's',
      skill: 'pdf-tools',
      callId: `c${index}`,
      windowId,
      ok: true,
      loadMs: 90,
    })
    list.push({
      t: 'window',
      at,
      windowId,
      sessionId: 's',
      skill: 'pdf-tools',
      toolCalls: calls,
      errors,
      errorNames: [],
      corrections: Array.from({ length: corrections }, () => '不对'),
      otherSkills: [],
      turnEnded: true,
      truncated: false,
      closeReason: 'user-turn',
      ok: !failurePattern.includes(index),
    })
  })
  return list
}

test('history lists loads chronologically and detects improvement', () => {
  const recs = records([
    { calls: 2, errors: 2, corrections: 1 },
    { calls: 2, errors: 2 },
    { calls: 2, errors: 0 },
    { calls: 2, errors: 0 },
  ])
  const history = buildHistory(recs, 'pdf-tools')
  assert.equal(history.loads.length, 4)
  assert.equal(history.loads[0].errors, 2)
  assert.equal(history.trend, 'improving', history.note)
  assert.match(history.note, /100% → 0%/)
  const text = renderHistoryMarkdown(history)
  assert.match(text, /## History — `pdf-tools`/)
  assert.match(text, /\| at \| ok \| calls \| errors \| corrections \| ms \| turn \|/)
  assert.match(renderHistoryMarkdown(buildHistory([], 'x')), /No closed window/)
})

test('history refuses a trend on too few loads', () => {
  const history = buildHistory(
    records([
      { calls: 2, errors: 0 },
      { calls: 2, errors: 1 },
    ]),
    'pdf-tools',
  )
  assert.equal(history.trend, 'not-enough-data')
  assert.match(history.note, /at least 4/)
})

test('impact pairs each screened edit with the loads before and after it', () => {
  const base = records([
    { calls: 2, errors: 1 },
    { calls: 2, errors: 1 },
    { calls: 2, errors: 0 },
    { calls: 2, errors: 0 },
  ])
  const editAt = now + 1_500 // between the second and third load
  base.push({
    t: 'edit',
    at: editAt,
    skill: 'pdf-tools',
    verdict: 'accept',
    dimension: 'reliability',
    hypothesis: 'fix paths',
  })
  const impact = buildImpact(base, 'pdf-tools')
  assert.equal(impact.edits, 1)
  const comparison = impact.comparisons[0]
  assert.equal(comparison.before.loads, 2)
  assert.equal(comparison.after.loads, 2)
  assert.equal(comparison.verdict, 'improved')
  assert.equal(comparison.delta, 1)
  assert.match(comparison.note, /100% → 0%/)
  const text = renderImpactMarkdown(impact)
  assert.match(text, /## Edit impact — `pdf-tools`/)
  assert.match(text, /fix paths/)
  assert.match(text, /Judgement rule/)
})

test('impact is inconclusive without two loads on each side', () => {
  const recs = records([
    { calls: 2, errors: 1 },
    { calls: 2, errors: 1 },
  ])
  recs.push({ t: 'edit', at: now + 10_000, skill: 'pdf-tools', verdict: 'warn', dimension: 'static' })
  const impact = buildImpact(recs, 'pdf-tools')
  assert.equal(impact.comparisons[0].verdict, 'inconclusive')
  assert.match(impact.comparisons[0].note, /needs 2 closed loads/)
})

test('impact counts failed loads after an edit as errors, not as clean runs', () => {
  const recs = records([
    { calls: 2, errors: 1 },
    { calls: 2, errors: 1 },
    { calls: 2, errors: 0 },
  ])
  recs.push({ t: 'edit', at: now + 10_000, skill: 'pdf-tools', verdict: 'accept', dimension: 'reliability' })
  for (let i = 0; i < 3; i += 1) {
    recs.push({
      t: 'skill',
      at: now + 11_000 + i * 1000,
      sessionId: 's',
      skill: 'pdf-tools',
      callId: `f${i}`,
      ok: false,
      error: 'ENOENT: SKILL.md',
    })
  }
  const comparison = buildImpact(recs, 'pdf-tools').comparisons[0]
  assert.equal(comparison.after.loads, 3)
  assert.equal(comparison.verdict, 'degraded')
})

test('impact with no edits explains the review step', () => {
  assert.match(
    renderImpactMarkdown(buildImpact(records([{ calls: 1, errors: 0 }]), 'pdf-tools')),
    /Use skill_eval_review/,
  )
})
