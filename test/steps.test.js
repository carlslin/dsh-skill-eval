import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSteps, scoreStep, stepsForSkill, summarizeSteps } from '../lib/steps.js'

test('scoreStep penalises errors, loop errors and call volume, clamped to 0..100', () => {
  assert.deepEqual(scoreStep({ toolCalls: 2, errors: 0, loopErrors: 0 }), {
    total: 100,
    grade: 'A',
    penalties: [],
  })
  const withErrors = scoreStep({ toolCalls: 2, errors: 2, loopErrors: 0 })
  assert.equal(withErrors.total, 60)
  assert.equal(withErrors.grade, 'D')
  assert.ok(withErrors.penalties.some((item) => item.id === 'tool-errors'))
  const bad = scoreStep({ toolCalls: 20, errors: 10, loopErrors: 3 })
  assert.equal(bad.total, 0)
  assert.equal(bad.grade, 'F')
  assert.equal(scoreStep(null), null)
})

test('buildSteps sanitises, scores and keeps the oldest-first tail', () => {
  const records = [
    { t: 'step', at: 3, sessionId: 's', turn: 1, step: 2, toolCalls: 1, errors: 0, skills: ['a', 7] },
    { t: 'step', at: 1, sessionId: 's', turn: 1, step: 1, toolCalls: 3, errors: 1, skills: ['a'] },
    { t: 'skill', at: 2 },
    { t: 'step', at: 2, sessionId: 's', turn: 2, step: 1, toolCalls: 1, errors: 0, tokens: { input: 10 } },
  ]
  const steps = buildSteps(records, { limit: 2 })
  assert.equal(steps.length, 2)
  assert.deepEqual(
    steps.map((step) => step.at),
    [2, 3],
  )
  assert.equal(steps[0].skills.length, 0)
  assert.equal(steps[1].skills.length, 1)
  assert.equal(steps[0].tokens.input, 10)
})

test('summarizeSteps groups turns, averages steps and reports the latest delta', () => {
  const raw = [
    { at: 1, sessionId: 's', turn: 1, step: 1, score: { total: 80 } },
    { at: 2, sessionId: 's', turn: 1, step: 2, score: { total: 100 } },
    { at: 3, sessionId: 's', turn: 2, step: 1, score: { total: 40 } },
    { at: 4, sessionId: 's', turn: 2, step: 2, score: { total: 60 } },
  ]
  const view = summarizeSteps(raw, { limit: 2 })
  assert.equal(view.turns.length, 2)
  assert.equal(view.turns[0].turn, 2)
  assert.equal(view.turns[0].average, 50)
  assert.equal(view.turns[1].average, 90)
  assert.equal(view.overall.steps, 4)
  assert.equal(view.overall.average, 70)
  assert.equal(view.overall.delta, -40)
  assert.equal(view.overall.latestAverage, 50)
  assert.equal(view.overall.previousAverage, 90)
})

test('stepsForSkill filters the trajectory by loaded skill', () => {
  const steps = [{ skills: ['a', 'b'] }, { skills: ['b'] }, { skills: [] }]
  assert.equal(stepsForSkill(steps, 'a').length, 1)
  assert.equal(stepsForSkill(steps, 'b').length, 2)
  assert.equal(stepsForSkill(steps, '').length, 3)
})
