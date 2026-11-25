import test from 'node:test'
import assert from 'node:assert/strict'
import { reportRows, toCsv } from '../src/lib/export.ts'
import type { Report } from '../src/lib/report.ts'

const REPORT = {
  skills: [
    {
      skill: 'pdf-tools',
      score: {
        total: 88.5,
        grade: 'B',
        dimensions: { static: 82, reliability: 100, effectiveness: 75, efficiency: 90 },
      },
      stats: {
        loads: 4,
        closed: 3,
        feedback: { positive: 2, negative: 1, categories: {}, notes: [] },
        outcomes: { deliverables: 1, workspaceChanges: 1, jobsSettled: 0, tasksCompleted: 0, workflowRuns: 0 },
        approvals: { asked: 1, decided: 1, rejected: 1 },
        compactions: 0,
        models: { 'deepseek/v4': 2 },
      },
      editImpact: { delta: 4.2 },
      editHistory: [{ at: 1 }, { at: 2 }],
      topAdvice: [{ id: 'user-corrections' }],
    },
    {
      skill: 'csv, "quoted"',
      score: { total: 70, grade: 'C', dimensions: {} },
      stats: {
        loads: 1,
        closed: 1,
        feedback: { positive: 0, negative: 0, categories: {}, notes: [] },
        outcomes: {},
        approvals: {},
        compactions: 0,
        models: {},
      },
      topAdvice: [],
    },
  ],
  totals: { invocations: 5, skills: 2, closed: 4 },
} as unknown as Report

test('reportRows flattens skill evidence for export', () => {
  const rows = reportRows(REPORT)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].feedback_positive, 2)
  assert.equal(rows[0].outcomes, 2)
  assert.equal(rows[0].edits, 2)
  assert.equal(rows[0].last_edit_delta, 4.2)
  assert.equal(rows[1].skill, 'csv, "quoted"')
})

test('toCsv escapes commas, quotes and keeps one row per skill', () => {
  const csv = toCsv(REPORT)
  const lines = csv.split('\n')
  assert.equal(lines.length, 3)
  assert.match(lines[0], /^skill,total,grade,/)
  assert.match(lines[1], /^pdf-tools,88.5,B,/)
  assert.match(lines[2], /^"csv, ""quoted""",70,C,/)
})
