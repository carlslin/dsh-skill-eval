import test from 'node:test'
import assert from 'node:assert/strict'
import { EDIT_DIMENSIONS, annealedBudget, explorationDirective } from '../lib/report.js'

test('the edit budget anneals from max to min as edits are accepted', () => {
  const values = Array.from({ length: 8 }, (_, accepted) => annealedBudget(accepted, { max: 4, min: 1, horizon: 6 }))
  assert.equal(values[0], 4)
  assert.equal(values[6], 1)
  assert.equal(values[7], 1)
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i] <= values[i - 1], values.join(','))
  // custom ranges are honoured and clamped
  assert.equal(annealedBudget(0, { max: 2, min: 2 }), 2)
  assert.ok(annealedBudget(99, { max: 6, min: 1 }) >= 1)
})

test('the exploration directive fires only after repeated same-dimension edits', () => {
  assert.equal(explorationDirective([]), null)
  assert.equal(explorationDirective([{ dimension: 'static' }]), null)
  assert.equal(explorationDirective([{ dimension: 'static' }, { dimension: 'static' }]).stuck, 'static')
  const flat = explorationDirective([{ dimension: 'static' }, { dimension: 'static' }, { dimension: 'static' }])
  assert.equal(flat.stuck, 'static')
  assert.notEqual(flat.suggestion, 'static')
  assert.ok(EDIT_DIMENSIONS.includes(flat.suggestion))
  assert.match(flat.reason, /static/)
  assert.equal(explorationDirective([{ dimension: 'static' }, { dimension: 'efficiency' }]), null)
})

test('the directive prefers the least-recently-used untouched dimension', () => {
  const directive = explorationDirective([
    { dimension: 'efficiency' },
    { dimension: 'static' },
    { dimension: 'static' },
  ])
  assert.equal(directive.stuck, 'static')
  assert.notEqual(directive.suggestion, 'efficiency')
})
