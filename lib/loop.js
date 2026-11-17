/**
 * The guided optimization loop: turn the current report into the next concrete
 * step, RRSI style — one attributable edit inside the annealed budget, screened
 * by the leakage critic, measured again afterwards.
 *
 * Pure: it reads a report and returns a plan; nothing is applied here.
 */

import { EDIT_DIMENSIONS } from './report.js'

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 }

function scoreLine(entry) {
  const score = entry.score ?? {}
  const ci = score.ci ? ` (95% CI ${score.ci.low}-${score.ci.high})` : ''
  return `${score.total ?? '—'}/100 ${score.grade ?? '?'}${ci}`
}

/** Pick the skill the user should work on next. */
export function pickLoopTarget(report, skillName) {
  const entries = Array.isArray(report?.skills) ? report.skills : []
  if (skillName) return entries.find((entry) => entry.skill === skillName) ?? null
  const withActionable = entries.filter((entry) =>
    (entry.advice ?? []).some((item) => item.severity === 'critical' || item.severity === 'warning'),
  )
  if (withActionable.length > 0) {
    // worst first: a low score with an actionable fix is the best place to spend a round
    return [...withActionable].sort((a, b) => (a.score?.total ?? 101) - (b.score?.total ?? 101))[0]
  }
  return entries[0] ?? null
}

/**
 * @param {object} report - the analyzer report
 * @param {{skill?: string, editBudgetMax?: number, minSamples?: number, reloads?: number}} options
 */
export function buildLoopPlan(report, options = {}) {
  const budgetMax = Number.isFinite(options.editBudgetMax) ? options.editBudgetMax : 4
  const reloads = Number.isFinite(options.reloads) ? options.reloads : (report?.scoring?.minSamples ?? 3)
  const target = pickLoopTarget(report, options.skill)
  if (!target) {
    return {
      empty: true,
      reason:
        (report?.skills ?? []).length === 0
          ? 'no skill loads recorded yet — load a skill once, then run the loop'
          : `no evidence for skill "${options.skill}"`,
      steps: [],
    }
  }

  const budget = Math.max(1, Math.min(Number(target.adviceBudget) || budgetMax, budgetMax))
  const actionable = [...(target.advice ?? [])]
    .filter((item) => item.severity === 'critical' || item.severity === 'warning')
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3))
  const chosen = actionable.slice(0, budget)
  const exploration = target.exploration ?? null

  const steps = []
  if (chosen.length === 0) {
    steps.push({
      kind: 'measure',
      title: `No actionable fix within the budget for ${target.skill}`,
      detail: `The evidence is ${scoreLine(target)}${target.score?.provisional ? ' (provisional)' : ''}. Keep using the skill and re-run the loop once ${reloads} more load(s) are recorded, or prune it if it stays low.`,
    })
  } else {
    steps.push({
      kind: 'edit',
      title: `Apply ${chosen.length === 1 ? 'one attributable edit' : `${chosen.length} edits`} (budget ${budget})`,
      detail: chosen.map((item) => `[${item.severity}] ${item.title} — ${item.fix}`).join('\n'),
    })
    const dimension = exploration ? exploration.suggestion : (chosen[0]?.dimension ?? null)
    steps.push({
      kind: 'review',
      title: 'Screen the edit before applying it',
      detail: `Call skill_eval_review {skill:"${target.skill}", dimension:"${dimension ?? 'static'}", hypothesis:"<what should improve and how you will measure it>", diff:"<the change>"}. A reject verdict means the edit leaks task-specific knowledge; revise instead of applying.`,
    })
    if (exploration) {
      steps.push({
        kind: 'explore',
        title: `Break the ${exploration.stuck} loop`,
        detail: `${exploration.reason}; make this edit about "${exploration.suggestion}" instead.`,
      })
    }
    steps.push({
      kind: 'measure',
      title: `Apply, then re-measure after ~${reloads} load(s)`,
      detail: `Current state: ${scoreLine(target)}. Compare the next report's score/CI for this skill; only keep the change when the interval moves, not when the point estimate does.`,
    })
  }

  return {
    skill: target.skill,
    score: target.score ?? null,
    budget,
    chosen,
    exploration,
    dimension: exploration ? exploration.suggestion : (chosen[0]?.dimension ?? null),
    steps,
    empty: false,
  }
}

export function renderLoopMarkdown(plan) {
  if (!plan || plan.empty) {
    return `## Optimization loop\n\n${plan?.reason ?? 'nothing to do'}`
  }
  const lines = [`## Optimization loop — \`${plan.skill}\``, '']
  lines.push(`current: **${scoreLine(plan)}** · edit budget this round: **${plan.budget}**`)
  if (plan.exploration) {
    lines.push(`exploration: ${plan.exploration.reason} → target \`${plan.exploration.suggestion}\``)
  }
  lines.push('')
  plan.steps.forEach((step, index) => {
    lines.push(`${index + 1}. **${step.title}**`)
    for (const line of String(step.detail).split('\n')) lines.push(`   ${line}`)
  })
  lines.push('')
  lines.push('Run `/skill-eval loop` again after the re-measurement round; the budget anneals as edits are accepted.')
  return lines.join('\n')
}

export const LOOP_HINT_DIMENSIONS = EDIT_DIMENSIONS

const DIMENSION_COST = { static: 1, lifecycle: 1, mcp: 1.5, efficiency: 1.5, reliability: 2.5, effectiveness: 2.5 }
const SEVERITY_WEIGHT = { critical: 1, warning: 0.5 }

/**
 * Expected-gain / cost ranking so the batch view answers "what should I fix
 * first", not just "who scores lowest".
 *
 * gain  = headroom (100 - score) plus a severity bonus, times evidence weight
 * cost  = how invasive the dimension usually is (a static body edit beats a
 *         behaviour change), divided so cheaper edits rank higher
 */
export function impactOf(plan) {
  const total = typeof plan?.score?.total === 'number' ? plan.score.total : null
  const chosen = plan?.chosen ?? []
  if (total === null || chosen.length === 0) return null
  const severity = Math.max(...chosen.map((item) => SEVERITY_WEIGHT[item.severity] ?? 0.25))
  const samples = plan.score?.samples ?? 0
  const minSamples = plan.score?.minSamples ?? 3
  const evidence = Math.max(0.35, Math.min(1, samples / Math.max(2, minSamples)))
  const gain = (100 - total) * severity * evidence
  const dimension = plan.dimension ?? chosen[0]?.dimension ?? 'static'
  const cost = DIMENSION_COST[dimension] ?? 2
  // Effort penalises sublinearly: a critical break still outranks a cosmetic
  // one-line fix, but a cheap static edit beats an equally sizeable behaviour
  // change.
  const score = gain / Math.sqrt(cost)
  return {
    score: Math.round(score * 10) / 10,
    expectedGain: Math.round(gain * 10) / 10,
    cost,
    severity,
    evidence: Math.round(evidence * 100) / 100,
    reasons: [
      `${Math.round(100 - total)} points of headroom`,
      severity === 1 ? 'critical fix' : 'warning-level fix',
      `~${cost}x effort (${dimension})`,
      evidence < 1 ? 'provisional evidence' : 'measured evidence',
    ],
  }
}

/** Every skill that currently has an actionable fix, worst score first. */
export function buildLoopPlans(report, options = {}) {
  const entries = (Array.isArray(report?.skills) ? report.skills : []).filter((entry) =>
    (entry.advice ?? []).some((item) => item.severity === 'critical' || item.severity === 'warning'),
  )
  const plans = entries.map((entry) => buildLoopPlan(report, { ...options, skill: entry.skill }))
  for (const plan of plans) plan.priority = impactOf(plan)
  return plans.sort((a, b) => (b.priority?.score ?? 0) - (a.priority?.score ?? 0))
}

export function renderLoopBatchMarkdown(plans) {
  if (!plans || plans.length === 0) {
    return '## Optimization loop\n\nNo skill currently has an actionable fix within budget. Keep using the skills and re-run once more loads are recorded.'
  }
  const lines = [`## Optimization loop — ${plans.length} skill(s) with an actionable fix`, '']
  for (const plan of plans) {
    const top = plan.chosen?.[0]
    const priority = plan.priority ? ` · priority ${plan.priority.score} (${plan.priority.reasons.join('; ')})` : ''
    lines.push(`### \`${plan.skill}\` — ${scoreLine(plan)} · budget ${plan.budget}${priority}`)
    if (top) lines.push(`- [${top.severity}] ${top.title}`)
    lines.push(`- fix: ${top ? top.fix : 'none'}`)
    const review = plan.steps?.find((step) => step.kind === 'review')
    if (review) lines.push(`- screen: \`skill_eval_review {skill:"${plan.skill}", dimension:"${plan.dimension}"}\``)
    if (plan.exploration)
      lines.push(`- explore: ${plan.exploration.reason} → target \`${plan.exploration.suggestion}\``)
    lines.push('')
  }
  lines.push('Run `/skill-eval loop <skill>` for the full step-by-step plan on one skill.')
  return lines.join('\n')
}
