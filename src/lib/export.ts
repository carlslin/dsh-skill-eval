import type { Report } from './report.ts'

/** One flat row per skill, suitable for CSV or spreadsheet import. */
export function reportRows(report: Report): Array<Record<string, string | number | null>> {
  return (report.skills ?? []).map((entry) => {
    const stats = entry.stats
    const outcomes = stats.outcomes ?? {}
    const produced =
      (outcomes.deliverables ?? 0) +
      (outcomes.workspaceChanges ?? 0) +
      (outcomes.jobsSettled ?? 0) +
      (outcomes.tasksCompleted ?? 0) +
      (outcomes.workflowRuns ?? 0)
    const impact = entry.editImpact
    return {
      skill: entry.skill,
      total: entry.score.total ?? null,
      grade: entry.score.grade ?? null,
      static: entry.score.dimensions.static ?? null,
      reliability: entry.score.dimensions.reliability ?? null,
      effectiveness: entry.score.dimensions.effectiveness ?? null,
      efficiency: entry.score.dimensions.efficiency ?? null,
      loads: stats.loads ?? 0,
      closed: stats.closed ?? 0,
      feedback_positive: stats.feedback.positive ?? 0,
      feedback_negative: stats.feedback.negative ?? 0,
      outcomes: produced,
      approvals_asked: stats.approvals.asked ?? 0,
      approvals_rejected: stats.approvals.rejected ?? 0,
      compactions: stats.compactions ?? 0,
      models: Object.keys(stats.models ?? {}).join('|') || null,
      edits: entry.editHistory?.length ?? (impact ? 1 : 0),
      last_edit_delta: impact?.delta ?? null,
      top_fixes: (entry.topAdvice ?? []).map((item) => item.id).join('|') || null,
    }
  })
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text
}

/** CSV with a stable header, in report row order. */
export function toCsv(report: Report): string {
  const rows = reportRows(report)
  const headers =
    rows.length > 0
      ? Object.keys(rows[0])
      : [
          'skill',
          'total',
          'grade',
          'static',
          'reliability',
          'effectiveness',
          'efficiency',
          'loads',
          'closed',
          'feedback_positive',
          'feedback_negative',
          'outcomes',
          'approvals_asked',
          'approvals_rejected',
          'compactions',
          'models',
          'edits',
          'last_edit_delta',
          'top_fixes',
        ]
  const lines = [headers.join(',')]
  for (const row of rows) lines.push(headers.map((header) => cell(row[header])).join(','))
  return lines.join('\n')
}
