import test from 'node:test'
import assert from 'node:assert/strict'
import { LEAK_RULES, reviewSkillEdit } from '../lib/critic.js'

test('a reusable mechanism passes the leakage critic', () => {
  const verdict = reviewSkillEdit({
    skill: 'pdf-tools',
    hypothesis:
      'Sharpen the trigger description so the skill activates for .pdf inputs; measure correction rate over the next 5 loads.',
    diff: '+ ## When to use\n+ Use when the input is a PDF and the user asks for extraction or reordering.\n+ Run scripts/inspect.py first.',
  })
  assert.equal(verdict.verdict, 'accept', JSON.stringify(verdict.reasons))
  assert.deepEqual(verdict.reasons, [])
})

test('hardcoded answers, benchmark names and task ids are rejected', () => {
  for (const [text, code] of [
    ['the expected output for this request is 42', 'hardcoded-answer'],
    ['benchmark: swe-bench verified case', 'benchmark-name'],
    ['if task_id == 17 then return the cached answer', 'task-specific-id'],
  ]) {
    const verdict = reviewSkillEdit({ skill: 'x', hypothesis: 'improve', diff: text })
    assert.equal(verdict.verdict, 'reject', `${code}: ${JSON.stringify(verdict.reasons)}`)
    assert.ok(
      verdict.reasons.some((reason) => reason.code === code),
      code,
    )
  }
})

test('dates, machine paths and missing hypotheses only warn', () => {
  const verdict = reviewSkillEdit({
    skill: 'x',
    hypothesis: '',
    diff: 'before 2026-06-01 use /Users/adams/data/x.csv',
  })
  assert.equal(verdict.verdict, 'warn')
  const codes = verdict.reasons.map((reason) => reason.code)
  assert.ok(codes.includes('hardcoded-date'), codes.join(','))
  assert.ok(codes.includes('user-specific-path'), codes.join(','))
  assert.ok(codes.includes('no-hypothesis'), codes.join(','))
})

test('an empty edit is rejected instead of accepted', () => {
  const verdict = reviewSkillEdit({ skill: 'x' })
  assert.equal(verdict.verdict, 'reject')
  assert.equal(verdict.reasons[0].code, 'empty-edit')
})

test('every rule is described so the reasons are actionable', () => {
  for (const rule of LEAK_RULES) {
    assert.ok(rule.code.length > 0)
    assert.ok(rule.label.length > 0)
    assert.ok(rule.detail.length > 0)
    assert.ok(['reject', 'warn'].includes(rule.severity))
  }
})
