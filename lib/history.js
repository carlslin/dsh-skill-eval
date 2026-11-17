/**
 * Time-aware answers: "when did this skill go bad" and "did my last edit help".
 *
 * Both work from the durable window records, so they need no new collection.
 * Judgements stay conservative: a delta smaller than one window of spread is
 * reported as inconclusive rather than as an improvement.
 */

import { formatTimestamp } from './html.js'
import { foldSamples } from './store.js'

const rate = (list, predicate) => (list.length === 0 ? null : list.filter(predicate).length / list.length)

function shapeLoad(sample) {
  const w = sample.window ?? {}
  return {
    at: sample.at,
    ok: sample.ok === true,
    loadMs: sample.loadMs ?? null,
    calls: w.toolCalls ?? null,
    errors: w.errors ?? null,
    corrections: Array.isArray(w.corrections) ? w.corrections.length : 0,
    otherSkills: Array.isArray(w.otherSkills) ? w.otherSkills.length : 0,
    loopErrors: w.loopErrors ?? 0,
    turn: sample.turn ?? null,
  }
}

/** Chronological load history for one skill, with a half-over-half trend. */
export function buildHistory(records, skill) {
  const group = foldSamples(records).find((item) => item.skill === skill)
  const samples = group ? group.samples : []
  const loads = samples.map(shapeLoad)
  const withWindow = loads.filter((load) => load.calls !== null)
  const split = Math.floor(withWindow.length / 2)
  const before = withWindow.slice(0, split)
  const after = withWindow.slice(split)
  const beforeRate = rate(before, (load) => load.errors > 0 || load.corrections > 0)
  const afterRate = rate(after, (load) => load.errors > 0 || load.corrections > 0)
  let trend = 'not-enough-data'
  let note = `need at least 4 closed loads to compare halves (have ${withWindow.length})`
  if (before.length >= 2 && after.length >= 2 && beforeRate !== null && afterRate !== null) {
    const delta = beforeRate - afterRate
    trend = delta > 0.2 ? 'improving' : delta < -0.2 ? 'degrading' : 'flat'
    note = `problem rate ${Math.round(beforeRate * 100)}% → ${Math.round(afterRate * 100)}% (${before.length} → ${after.length} loads)`
  }
  return {
    skill,
    loads,
    closed: withWindow.length,
    trend,
    note,
    firstAt: loads[0]?.at ?? null,
    lastAt: loads[loads.length - 1]?.at ?? null,
  }
}

/**
 * Pair each screened edit with the loads recorded before and after it.
 * Edits without a timestamp or without two closed loads on a side are
 * inconclusive rather than silently "improved".
 */
export function buildImpact(records, skill) {
  const group = foldSamples(records).find((item) => item.skill === skill)
  const samples = group ? group.samples : []
  const edits = records
    .filter((record) => record && record.t === 'edit' && record.skill === skill && Number.isFinite(record.at))
    .sort((a, b) => a.at - b.at)
  const comparisons = edits.map((edit) => {
    const before = samples.filter((sample) => sample.at < edit.at)
    const after = samples.filter((sample) => sample.at > edit.at)
    const rateOf = (list) => rate(list, (sample) => (sample.window?.errors ?? 0) > 0)
    const beforeRate = rateOf(before)
    const afterRate = rateOf(after)
    const enough = before.length >= 2 && after.length >= 2
    let verdict = 'inconclusive'
    let delta = null
    if (enough && beforeRate !== null && afterRate !== null) {
      delta = Math.round((beforeRate - afterRate) * 1000) / 1000
      verdict = delta > 0.15 ? 'improved' : delta < -0.15 ? 'degraded' : 'flat'
    }
    return {
      at: edit.at,
      dimension: edit.dimension ?? null,
      hypothesis: edit.hypothesis ?? '',
      screened: edit.verdict ?? null,
      before: { loads: before.length, errorRate: beforeRate },
      after: { loads: after.length, errorRate: afterRate },
      delta,
      verdict,
      note: enough
        ? `error rate ${beforeRate === null ? '—' : Math.round(beforeRate * 100) + '%'} → ${
            afterRate === null ? '—' : Math.round(afterRate * 100) + '%'
          } (${before.length} / ${after.length} loads)`
        : `needs 2 closed loads on each side (have ${before.length} / ${after.length})`,
    }
  })
  return { skill, edits: edits.length, comparisons }
}

export function renderHistoryMarkdown(history) {
  if (!history || history.loads.length === 0) return `No closed window recorded for \`${history?.skill ?? '?'}\` yet.`
  const lines = [
    `## History — \`${history.skill}\``,
    '',
    `loads: **${history.loads.length}** (${history.closed} closed) · trend: **${history.trend}**`,
    history.note,
    '',
    '| at | ok | calls | errors | corrections | ms | turn |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const load of history.loads.slice(-15)) {
    const when = formatTimestamp(load.at)
    lines.push(
      `| ${when} | ${load.ok ? 'yes' : 'no'} | ${load.calls ?? '—'} | ${load.errors ?? '—'} | ${load.corrections} | ${
        load.loadMs ?? '—'
      } | ${load.turn ?? '—'} |`,
    )
  }
  return lines.join('\n')
}

export function renderImpactMarkdown(impact) {
  if (!impact || impact.edits === 0)
    return `No screened edit recorded for \`${impact?.skill ?? '?'}\` yet. Use skill_eval_review before changing it.`
  const lines = [`## Edit impact — \`${impact.skill}\``, '', `${impact.edits} screened edit(s)`, '']
  for (const comparison of impact.comparisons) {
    const when = formatTimestamp(comparison.at)
    lines.push(`### ${when} · ${comparison.dimension ?? 'unspecified'} · ${comparison.verdict}`)
    if (comparison.hypothesis) lines.push(`hypothesis: ${comparison.hypothesis}`)
    lines.push(`- ${comparison.note}`)
    if (comparison.delta !== null) {
      lines.push(
        `- error-rate delta: ${comparison.delta > 0 ? '-' : '+'}${Math.abs(Math.round(comparison.delta * 100))}pp`,
      )
    }
    lines.push('')
  }
  lines.push('Judgement rule: only ≥2 closed loads on each side and a >15pp delta counts as improved/degraded.')
  return lines.join('\n')
}
