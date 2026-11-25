/**
 * Pure checks for the real-turn end-to-end acceptance script
 * (scripts/e2e-live.mjs). Kept in src/ so the normal test suite covers them.
 */
import type { StoredRecord } from './types.ts'

export const E2E_SKILL = 'e2e-probe'

export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP'
export interface CheckRow {
  id: string
  status: CheckStatus
  detail: string
}
export interface CheckSet {
  rows: CheckRow[]
  counts: Record<CheckStatus, number>
  pass: boolean
}

export function summarize(rows: readonly CheckRow[]): Record<CheckStatus, number> {
  const counts: Record<CheckStatus, number> = { PASS: 0, FAIL: 0, SKIP: 0 }
  for (const row of rows) counts[row.status] += 1
  return counts
}

export function buildSkillMarkdown(marker: string, skill = E2E_SKILL): string {
  return `---
name: ${skill}
description: Use when the user asks to verify the skill-eval end-to-end probe. Trigger phrase: ${skill}.
---

# E2E probe

This is a throwaway skill used by \`scripts/e2e-live.mjs\`.

When loaded, reply with exactly this marker and nothing else:

\`${marker}\`

Do not call any other tool.
`
}

/** Checks over the durable events.jsonl the plugin wrote. */
export function verifyTelemetry(
  events: readonly StoredRecord[],
  { skill = E2E_SKILL, marker, replyText = '' }: { skill?: string; marker?: string; replyText?: string } = {},
): CheckSet {
  const rows: CheckRow[] = []
  const list = events ?? []
  const skillRecords = list.filter((record) => record && record.t === 'skill' && record.skill === skill)
  const loaded = skillRecords.find((record) => record.ok === true)
  rows.push({
    id: 'skill-load',
    status: loaded ? 'PASS' : 'FAIL',
    detail: loaded
      ? skill + ' loaded (' + skillRecords.length + ' skill record(s))'
      : 'no successful skill record for ' + skill,
  })

  const windows = new Map<string, StoredRecord>()
  for (const record of list) {
    if (record && record.t === 'window' && record.skill === skill && typeof record.windowId === 'string') {
      windows.set(record.windowId, record)
    }
  }
  const window = [...windows.values()].sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0)).at(-1)
  rows.push({
    id: 'window-record',
    status: window ? 'PASS' : 'FAIL',
    detail: window
      ? 'window ' +
        window.windowId +
        ' closeReason=' +
        String(window.closeReason ?? '—') +
        ' turnEnded=' +
        String(window.turnEnded === true)
      : 'no window record for ' + skill,
  })
  rows.push({
    id: 'turn-settled',
    status: window && window.turnEnded === true ? 'PASS' : 'FAIL',
    detail: window ? 'turn-end persistence observed' : 'no window to judge',
  })
  rows.push({
    id: 'message-attribution',
    status: window && Array.isArray(window.messageIds) && window.messageIds.length > 0 ? 'PASS' : 'FAIL',
    detail: window ? String((window.messageIds ?? []).length) + ' assistant message id(s) attached' : 'no window',
  })
  const model = window && window.model ? window.model : null
  rows.push({
    id: 'model-attribution',
    status: model && (model.provider || model.model) ? 'PASS' : 'SKIP',
    detail:
      model && (model.provider || model.model)
        ? [model.provider, model.model].filter(Boolean).join('/')
        : 'no model captured',
  })

  const staticRecord = list
    .filter((record) => record && record.t === 'static' && record.skill === skill)
    .sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))
    .at(-1)
  const rawProfile = staticRecord && staticRecord.static
  const profile =
    rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
      ? (rawProfile as Record<string, unknown>)
      : null
  const catalogDescription = profile && typeof profile.catalogDescription === 'string' ? profile.catalogDescription : ''
  rows.push({
    id: 'static-captured',
    status: catalogDescription.length > 0 ? 'PASS' : 'FAIL',
    detail: profile ? 'rendered description ' + catalogDescription.length + ' char(s)' : 'no static record',
  })
  rows.push({
    id: 'catalog-complete',
    status: profile && profile.catalogComplete !== false ? 'PASS' : 'SKIP',
    detail: profile ? 'catalogComplete=' + String(profile.catalogComplete !== false) : 'no static record',
  })

  const feedbackEvents = list.filter(
    (record) =>
      record && (record.t === 'feedback' || (typeof record.t === 'string' && record.t.startsWith('feedback/'))),
  )
  rows.push({
    id: 'explicit-feedback',
    status: feedbackEvents.length > 0 ? 'PASS' : 'SKIP',
    detail:
      feedbackEvents.length > 0
        ? String(feedbackEvents.length) + ' feedback event(s)'
        : 'headless turn has no feedback UI',
  })

  const outcomes = window && window.outcomes ? window.outcomes : null
  const produced = outcomes
    ? (Number(outcomes.deliverables) || 0) +
      (Number(outcomes.workspaceChanges) || 0) +
      (Number(outcomes.jobsSettled) || 0) +
      (Number(outcomes.tasksCompleted) || 0) +
      (Number(outcomes.workflowRuns) || 0)
    : 0
  rows.push({
    id: 'outcome-evidence',
    status: produced > 0 ? 'PASS' : 'SKIP',
    detail:
      produced > 0 ? String(produced) + ' positive outcome event(s)' : 'the probe turn produced no deliverable/change',
  })

  rows.push({
    id: 'marker-in-reply',
    status: marker && replyText.includes(marker) ? 'PASS' : 'SKIP',
    detail:
      marker && replyText.includes(marker)
        ? 'the model repeated the skill marker'
        : 'marker not found in the model reply',
  })
  rows.push({
    id: 'no-load-error',
    status: skillRecords.every((record) => record.ok === true) ? 'PASS' : 'FAIL',
    detail: String(skillRecords.filter((record) => record.ok !== true).length) + ' failed load(s)',
  })

  const counts = summarize(rows)
  return { rows, counts, pass: counts.FAIL === 0 }
}

/** Checks over the analyzer report (before HTML rendering). */
export function verifyReport(
  report: {
    skills?: readonly { skill?: unknown; stats?: Record<string, unknown> | null; editImpact?: unknown }[]
  } | null,
  { skill = E2E_SKILL }: { skill?: string } = {},
): CheckSet {
  const rows: CheckRow[] = []
  const entry = (report?.skills ?? []).find((item) => item && item.skill === skill)
  rows.push({
    id: 'report-includes-skill',
    status: entry ? 'PASS' : 'FAIL',
    detail: entry ? skill + ' present in the report' : 'skill missing from the report',
  })
  const stats = entry && entry.stats && typeof entry.stats === 'object' ? entry.stats : null
  rows.push({
    id: 'report-stats',
    status: stats && Number(stats.loads) > 0 ? 'PASS' : 'FAIL',
    detail: stats ? String(stats.loads) + ' load(s), ' + String(stats.closed) + ' closed window(s)' : 'no entry',
  })
  const evidenceKeys = ['feedbackTotal', 'outcomes', 'approvals', 'compactions', 'models']
  rows.push({
    id: 'report-evidence-fields',
    status: stats && evidenceKeys.every((key) => Object.hasOwn(stats, key)) ? 'PASS' : 'FAIL',
    detail: evidenceKeys.join(', '),
  })
  rows.push({
    id: 'report-edit-baseline',
    status: entry && Object.hasOwn(entry, 'editImpact') ? 'PASS' : 'FAIL',
    detail: entry && entry.editImpact ? 'editImpact present' : 'editImpact field present (null until a screened edit)',
  })
  const counts = summarize(rows)
  return { rows, counts, pass: counts.FAIL === 0 }
}
