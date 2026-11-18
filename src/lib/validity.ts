/**
 * Validity dashboard: what this evidence can and cannot support.
 *
 * The honest part of an evaluator is knowing which claims are measured and
 * which are still guesses. This module derives only statistics that the stored
 * report and ledger actually contain — no extrapolation, no invented metrics.
 */

import type { Advice, Severity } from './types.ts'

/** The report fields validity reads; kept structural so report.ts can call it while it is still building. */
export interface ValidityInput {
  skills?: Array<{
    score?: { ci?: unknown; provisional?: boolean } | null
    advice?: Advice[]
    exploration?: unknown
  } | null>
  edits?: Array<{ verdict?: string; dimension?: unknown; hypothesis?: unknown } | null>
  scoring?: { minSamples?: number; resamples?: number | null } | null
  ranking?: { significant?: boolean | null } | null
  generatedAt?: string | null
  dataDir?: string | null
}

export function buildValidity(report: ValidityInput | null | undefined, options: { minSamples?: number } = {}) {
  const skills = Array.isArray(report?.skills) ? report.skills : []
  const edits = Array.isArray(report?.edits) ? report.edits : []
  const minSamples = options.minSamples ?? report?.scoring?.minSamples ?? 3
  const resamples = report?.scoring?.resamples ?? null

  const withCI = skills.filter((entry) => entry?.score?.ci).length
  const provisional = skills.filter((entry) => entry?.score?.provisional).length
  const ranked = report?.ranking?.significant
  const adviceCounts: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
  for (const entry of skills) {
    for (const item of entry?.advice ?? []) {
      if (adviceCounts[item.severity] !== undefined) adviceCounts[item.severity] += 1
    }
  }

  const ledger: {
    total: number
    accept: number
    warn: number
    reject: number
    dimensions: Record<string, number>
    withHypothesis: number
  } = {
    total: edits.length,
    accept: 0,
    warn: 0,
    reject: 0,
    dimensions: Object.create(null),
    withHypothesis: 0,
  }
  const VERDICTS = new Set(['accept', 'warn', 'reject'])
  for (const entry of edits) {
    if (entry && entry.verdict && VERDICTS.has(entry.verdict))
      ledger[entry.verdict as 'accept' | 'warn' | 'reject'] += 1
    if (entry && typeof entry.dimension === 'string' && entry.dimension) {
      ledger.dimensions[entry.dimension] = (ledger.dimensions[entry.dimension] ?? 0) + 1
    }
    if (entry && entry.hypothesis) ledger.withHypothesis += 1
  }

  const explorable = skills.filter((entry) => entry?.exploration).length
  const actionable = skills.filter((entry) =>
    (entry?.advice ?? []).some((item) => item.severity === 'critical' || item.severity === 'warning'),
  ).length

  const canSay: string[] = []
  const cannotSay: string[] = []
  if (skills.length > 0) canSay.push(`scores for ${skills.length} skill(s) from recorded loads`)
  if (withCI > 0) canSay.push(`95% intervals for ${withCI} skill(s) (bootstrap resamples: ${resamples ?? 'unknown'})`)
  if (ranked === false) canSay.push('at least two skills are a statistical tie')
  if (ledger.accept > 0) canSay.push(`${ledger.accept} edit(s) screened and accepted before applying`)
  if (withCI < skills.length) {
    cannotSay.push(
      `${skills.length - withCI} skill(s) have no interval yet (n < ${minSamples}) — their score is provisional`,
    )
  }
  if (skills.length < 3) cannotSay.push('too few skills to estimate a ranking or a cross-skill baseline')
  cannotSay.push('before/after effect of an edit: needs the same skill measured across the edit boundary')
  cannotSay.push('token cost of a skill the model did not actually load')

  const canSayZh: string[] = []
  const cannotSayZh: string[] = []
  if (skills.length > 0) canSayZh.push(`基于已记录加载的 ${skills.length} 个技能分数`)
  if (withCI > 0) canSayZh.push(`${withCI} 个技能的 95% 区间（bootstrap 重采样：${resamples ?? '未知'}）`)
  if (ranked === false) canSayZh.push('至少两个技能在统计上打平')
  if (ledger.accept > 0) canSayZh.push(`${ledger.accept} 项改动在应用前经过审查并被接受`)
  if (withCI < skills.length)
    cannotSayZh.push(`${skills.length - withCI} 个技能还没有区间（样本 < ${minSamples}），分数是临时值`)
  if (skills.length < 3) cannotSayZh.push('技能太少，无法估计排名或跨技能基线')
  cannotSayZh.push('改动前后的效果：需要在改动边界两侧对同一技能测量')
  cannotSayZh.push('模型并未真正加载的技能其 token 成本')

  return {
    generatedAt: report?.generatedAt ?? null,
    dataDir: report?.dataDir ?? null,
    coverage: { skills: skills.length, withCI, provisional, actionable, explorable },
    ranking: {
      significant: ranked === true,
      unknown: ranked === null || ranked === undefined,
      significantReported: ranked !== undefined,
    },
    advice: adviceCounts,
    ledger,
    canSay,
    cannotSay,
    canSayZh,
    cannotSayZh,
  }
}

export function renderValidityMarkdown(validity: ReturnType<typeof buildValidity> | null | undefined): string {
  if (!validity) return '## Validity\n\nno report yet'
  const c = validity.coverage
  const l = validity.ledger
  const lines = [
    '## Validity — what the evidence supports',
    '',
    `coverage: **${c.skills}** skill(s) · **${c.withCI}** with 95% intervals · **${c.provisional}** provisional · **${c.actionable}** with an actionable fix`,
    `ranking: ${
      validity.ranking.unknown
        ? 'not enough evidence (fewer than two 95% intervals)'
        : validity.ranking.significant
          ? '**significant**'
          : 'not significant (intervals overlap)'
    }`,
    `advice: ${validity.advice.critical} critical · ${validity.advice.warning} warning · ${validity.advice.info} info`,
    `ledger: ${l.total} edit(s) screened — ${l.accept} accept · ${l.warn} warn · ${l.reject} reject` +
      (Object.keys(l.dimensions).length > 0
        ? ` · dimensions: ${Object.entries(l.dimensions)
            .map(([key, count]) => `${key}×${count}`)
            .join(', ')}`
        : ''),
    '',
    '### Can say',
    ...validity.canSay.map((item) => `- ${item}`),
    '',
    '### Cannot say yet',
    ...validity.cannotSay.map((item) => `- ${item}`),
  ]
  if (validity.coverage.explorable > 0) {
    lines.push('', `exploration: ${c.explorable} skill(s) stuck on one dimension — see \`/skill-eval loop all\``)
  }
  return lines.join('\n')
}
