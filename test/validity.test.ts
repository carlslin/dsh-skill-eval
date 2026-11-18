import test from 'node:test'
import assert from 'node:assert/strict'
import { buildValidity, renderValidityMarkdown } from '../src/lib/validity.ts'
import type { Report } from '../src/lib/report.ts'
import type { ValidityInput } from '../src/lib/validity.ts'
import { partial } from './helpers.ts'

function report(overrides = {}) {
  return partial<ValidityInput & Report>({
    generatedAt: '2026-11-15T00:00:00.000Z',
    dataDir: '/tmp/x',
    ranking: { significant: false },
    scoring: { minSamples: 3, resamples: 200 },
    skills: [
      {
        skill: 'a',
        score: { total: 70, ci: { low: 60, high: 80 }, provisional: false },
        advice: [{ severity: 'critical' }, { severity: 'info' }],
        exploration: null,
      },
      {
        skill: 'b',
        score: { total: 85, provisional: true },
        advice: [{ severity: 'warning' }],
        exploration: { stuck: 'static', suggestion: 'efficiency', reason: 'x' },
      },
    ],
    edits: [
      { verdict: 'accept', dimension: 'static', hypothesis: 'h' },
      { verdict: 'reject', dimension: 'reliability', hypothesis: '' },
      { verdict: 'warn' },
    ],
    ...overrides,
  })
}

test('validity counts coverage, advice and ledger without inventing metrics', () => {
  const validity = buildValidity(report())
  assert.deepEqual(validity.coverage, { skills: 2, withCI: 1, provisional: 1, actionable: 2, explorable: 1 })
  assert.equal(validity.ranking.significant, false)
  assert.deepEqual(validity.advice, { critical: 1, warning: 1, info: 1 })
  assert.deepEqual(
    { ...validity.ledger, dimensions: { ...validity.ledger.dimensions } },
    {
      total: 3,
      accept: 1,
      warn: 1,
      reject: 1,
      dimensions: { static: 1, reliability: 1 },
      withHypothesis: 1,
    },
  )
  assert.ok(validity.cannotSay.some((line) => /no interval/.test(line)))
  assert.ok(validity.cannotSay.some((line) => /before\/after/.test(line)))
  assert.ok(validity.canSay.some((line) => /statistical tie/.test(line)))
})

test('an empty report says nothing is measurable yet', () => {
  const validity = buildValidity({ skills: [], edits: [], scoring: { minSamples: 3 } })
  assert.equal(validity.coverage.skills, 0)
  assert.equal(validity.ledger.total, 0)
  assert.ok(validity.cannotSay.length > 0)
  assert.match(renderValidityMarkdown(validity), /Cannot say yet/)
  assert.match(renderValidityMarkdown(null), /no report yet/)
})

test('the markdown dashboard is readable and cites the ledger', () => {
  const text = renderValidityMarkdown(buildValidity(report()))
  assert.match(text, /## Validity — what the evidence supports/)
  assert.match(text, /coverage: \*\*2\*\* skill\(s\)/)
  assert.match(text, /ledger: 3 edit\(s\) screened — 1 accept · 1 warn · 1 reject/)
  assert.match(text, /dimensions: static×1, reliability×1/)
  assert.match(text, /exploration: 1 skill\(s\) stuck/)
  assert.match(text, /before\/after effect of an edit/)
})
