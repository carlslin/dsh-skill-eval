import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLoopPlan,
  buildLoopPlans,
  impactOf,
  pickLoopTarget,
  renderLoopBatchMarkdown,
  renderLoopMarkdown,
  LOOP_HINT_DIMENSIONS,
} from '../src/lib/loop.ts'
import { EDIT_DIMENSIONS } from '../src/lib/report.ts'
import type { Report, SkillEntry } from '../src/lib/report.ts'
import { partial } from './helpers.ts'
import type { DeepPartial } from './helpers.ts'

function reportWith(skills: SkillEntry[]) {
  return partial<Report>({ skills, scoring: { minSamples: 3 } })
}

test('loop hint dimensions track the shared edit dimensions', () => {
  assert.deepEqual([...LOOP_HINT_DIMENSIONS].sort(), [...EDIT_DIMENSIONS].sort())
})

const entry = (overrides: DeepPartial<SkillEntry> = {}) =>
  partial<SkillEntry>({
    skill: 'pdf-tools',
    score: { total: 58, grade: 'F', ci: { low: 50, high: 66 }, provisional: false },
    adviceBudget: 2,
    advice: [
      {
        id: 'post-load-errors',
        severity: 'critical',
        dimension: 'reliability',
        title: 'Tool calls fail',
        fix: 'Fix the paths.',
      },
      { id: 'no-example', severity: 'info', dimension: 'static', title: 'No example', fix: 'Add one.' },
      {
        id: 'trigger-collision',
        severity: 'warning',
        dimension: 'static',
        title: 'Collides',
        fix: 'Tighten triggers.',
      },
    ],
    ...overrides,
  })

test('the loop picks a target and respects the annealed budget', () => {
  const plan = buildLoopPlan(reportWith([entry()]), { editBudgetMax: 4 })
  assert.equal(plan.skill, 'pdf-tools')
  assert.equal(plan.budget, 2)
  assert.deepEqual(
    plan.chosen.map((item) => item.id),
    ['post-load-errors', 'trigger-collision'],
  )
  assert.equal(plan.steps[0].kind, 'edit')
  assert.ok(plan.steps.some((step) => step.kind === 'review'))
  assert.match(plan.steps.find((step) => step.kind === 'review')?.detail ?? '', /skill_eval_review/)
  assert.match(plan.steps.find((step) => step.kind === 'review')?.detail ?? '', /dimension:"reliability"/)
})

test('a named skill wins over the worst one; unknown names report empty', () => {
  const second = entry({ skill: 'other-skill', adviceBudget: 1 })
  assert.equal(pickLoopTarget(reportWith([entry(), second]), 'other-skill')?.skill, 'other-skill')
  const plan = buildLoopPlan(reportWith([entry()]), { skill: 'missing' })
  assert.equal(plan.empty, true)
  assert.match(plan.reason, /missing/)
  assert.match(renderLoopMarkdown(plan), /nothing to do|no evidence/)
})

test('an exploration directive steers the next edit dimension', () => {
  const plan = buildLoopPlan(
    reportWith([
      entry({ exploration: { stuck: 'static', suggestion: 'efficiency', reason: 'last 2 edits targeted static' } }),
    ]),
  )
  assert.equal(plan.dimension, 'efficiency')
  assert.ok(plan.steps.some((step) => step.kind === 'explore'))
  assert.match(renderLoopMarkdown(plan), /exploration/)
})

test('nothing actionable within budget falls back to measuring', () => {
  const quiet = entry({ advice: [{ id: 'low-sample', severity: 'info', title: 'Few samples', fix: 'Wait.' }] })
  const plan = buildLoopPlan(reportWith([quiet]))
  assert.equal(plan.chosen?.length, 0)
  assert.equal(plan.steps[0].kind, 'measure')
  assert.match(plan.steps[0].detail, /load\(s\)/)
})

test('an empty report explains itself instead of throwing', () => {
  const plan = buildLoopPlan(reportWith([]))
  assert.equal(plan.empty, true)
  assert.match(plan.reason, /no skill loads/)
  assert.match(renderLoopMarkdown(null), /nothing to do/)
})

test('the rendered plan is copy-pasteable markdown', () => {
  const text = renderLoopMarkdown(buildLoopPlan(reportWith([entry()])))
  assert.match(text, /^## Optimization loop — `pdf-tools`/)
  assert.match(text, /edit budget this round: \*\*2\*\*/)
  assert.match(text, /^1\. /m)
  assert.match(text, /\/skill-eval loop/)
})

test('the worst actionable skill is picked first', () => {
  const good = entry({ skill: 'good-skill', score: { total: 91, grade: 'A', ci: null } })
  const bad = entry({ skill: 'bad-skill', score: { total: 44, grade: 'F', ci: null } })
  assert.equal(pickLoopTarget(reportWith([good, bad]))?.skill, 'bad-skill')
  // a named skill still wins
  assert.equal(pickLoopTarget(reportWith([good, bad]), 'good-skill')?.skill, 'good-skill')
})

test('the batch plan lists only actionable skills, worst first', () => {
  const actionable = entry({ skill: 'sig', score: { total: 61, grade: 'D', ci: null }, adviceBudget: 2 })
  const healthy = entry({
    skill: 'healthy',
    score: { total: 95, grade: 'A', ci: null },
    advice: [{ id: 'low-sample', severity: 'info', title: 'Few', fix: 'Wait.' }],
  })
  const worse = entry({ skill: 'worse', score: { total: 40, grade: 'F', ci: null }, adviceBudget: 1 })
  const plans = buildLoopPlans(reportWith([actionable, healthy, worse]))
  assert.deepEqual(
    plans.map((plan) => plan.skill),
    ['worse', 'sig'],
  )
  const text = renderLoopBatchMarkdown(plans)
  assert.match(text, /2 skill\(s\) with an actionable fix/)
  assert.match(text, /### `worse`/)
  assert.match(text, /skill_eval_review \{skill:"worse", dimension:/)
  assert.match(renderLoopBatchMarkdown([]), /No skill currently has an actionable fix/)
})

test('batch plans are ranked by expected gain per unit of cost', () => {
  const critical = entry({
    skill: 'critical-skill',
    score: { total: 55, grade: 'F', samples: 6, minSamples: 3, ci: null },
    advice: [{ id: 'x', severity: 'critical', dimension: 'reliability', title: 'Breaks', fix: 'Fix.' }],
  })
  const cheap = entry({
    skill: 'cheap-skill',
    score: { total: 62, grade: 'D', samples: 6, minSamples: 3, ci: null },
    advice: [{ id: 'y', severity: 'warning', dimension: 'static', title: 'Weak body', fix: 'Edit.' }],
  })
  const plans = buildLoopPlans(reportWith([cheap, critical]))
  assert.equal(plans[0].skill, 'critical-skill')
  const bySkill = Object.fromEntries(plans.map((plan) => [plan.skill, plan]))
  const priority = (skill: string) => {
    const value = bySkill[skill]?.priority
    assert.ok(value, skill)
    return value
  }
  assert.ok(priority('critical-skill').score > priority('cheap-skill').score)
  assert.equal(priority('critical-skill').cost, 2.5)
  assert.equal(priority('cheap-skill').cost, 1)
  assert.equal(priority('critical-skill').evidence, 1)
  const text = renderLoopBatchMarkdown(plans)
  assert.match(text, /priority \d+/)
  assert.match(text, /~2\.5x effort \(reliability\)/)
  assert.equal(impactOf({ score: partial<SkillEntry['score']>({ total: null }), chosen: [] }), null)
})
