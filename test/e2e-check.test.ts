import test from 'node:test'
import assert from 'node:assert/strict'
import { E2E_SKILL, buildSkillMarkdown, verifyReport, verifyTelemetry } from '../src/lib/e2e.ts'
import type { StoredRecord } from '../src/lib/types.ts'

const MARKER = 'E2E-MARKER-TEST'

function events(): StoredRecord[] {
  return [
    { t: 'skill', at: 1, skill: E2E_SKILL, ok: true, windowId: 's:1' },
    {
      t: 'window',
      at: 2,
      skill: E2E_SKILL,
      windowId: 's:1',
      turnEnded: true,
      closeReason: 'turn-end',
      messageIds: ['m1', 'm2'],
      model: { provider: 'deepseek', model: 'flash' },
      outcomes: {
        deliverables: 1,
        workspaceChanges: 0,
        jobsSettled: 0,
        jobsFailed: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        workflowRuns: 0,
      },
    },
    {
      t: 'static',
      at: 2,
      skill: E2E_SKILL,
      static: { catalogDescription: 'probe description', catalogComplete: true, resolved: true },
    },
  ]
}

test('the e2e probe skill carries a valid name, description and marker', () => {
  const markdown = buildSkillMarkdown(MARKER)
  assert.match(markdown, new RegExp('^---\\nname: ' + E2E_SKILL))
  assert.match(markdown, /description: Use when/)
  assert.match(markdown, new RegExp(MARKER))
})

test('verifyTelemetry passes on a settled skill turn and skips optional evidence', () => {
  const result = verifyTelemetry(events(), { marker: MARKER, replyText: 'answer ' + MARKER })
  assert.equal(result.pass, true)
  const byId = new Map(result.rows.map((row) => [row.id, row]))
  assert.equal(byId.get('skill-load')?.status, 'PASS')
  assert.equal(byId.get('turn-settled')?.status, 'PASS')
  assert.equal(byId.get('message-attribution')?.status, 'PASS')
  assert.equal(byId.get('model-attribution')?.status, 'PASS')
  assert.equal(byId.get('static-captured')?.status, 'PASS')
  assert.equal(byId.get('catalog-complete')?.status, 'PASS')
  assert.equal(byId.get('outcome-evidence')?.status, 'PASS')
  assert.equal(byId.get('explicit-feedback')?.status, 'SKIP')
  assert.equal(byId.get('marker-in-reply')?.status, 'PASS')
})

test('verifyTelemetry fails when the skill never loaded', () => {
  const result = verifyTelemetry([], { marker: MARKER, replyText: '' })
  assert.equal(result.pass, false)
  assert.equal(result.counts.FAIL > 0, true)
})

test('verifyReport requires the skill entry, stats and edit baseline field', () => {
  const report = {
    skills: [
      {
        skill: E2E_SKILL,
        stats: {
          loads: 1,
          closed: 1,
          feedbackTotal: 0,
          outcomes: {},
          approvals: {},
          compactions: 0,
          models: {},
        },
        editImpact: null,
      },
    ],
  }
  const result = verifyReport(report)
  assert.equal(result.pass, true)
  const missing = verifyReport({ skills: [{ skill: 'other', stats: {}, editImpact: null }] })
  assert.equal(missing.pass, false)
})
