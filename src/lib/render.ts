/** Rendering helpers: markdown for the agent-facing tool, HTML for the web dashboard. */

import { localizeReport } from './advice.ts'
import { escapeHtml as esc, escapeMdCell, formatTimestamp } from './html.ts'
import type { Report, SkillEntry } from './report.ts'
import type { buildValidity } from './validity.ts'
import type { Advice } from './types.ts'

function bar(value: number | null | undefined, width = 10): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '·'.repeat(width)
  const filled = Math.round((Math.max(0, Math.min(100, value)) / 100) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function fmt(x: number | null | undefined, digits = 1): string {
  return x === null || x === undefined || !Number.isFinite(x) ? '—' : Number(x).toFixed(digits)
}

function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`
}

const SEV_ICON: Record<string, string> = { critical: '🛑', warning: '⚠️', info: 'ℹ️' }

export function renderMcpMarkdown(
  report: Pick<Report, 'mcpServers' | 'mcpAdvice'> & { mcp?: Report['mcp'] | null },
): string {
  const rows = report.mcpServers ?? []
  const lines = ['## MCP servers', '']
  if (rows.length === 0) {
    lines.push('No MCP calls recorded yet. MCP tools reach the model as `mcp__<server>__<tool>`.')
    return lines.join('\n')
  }
  lines.push('| server | health | grade | calls | errors | error rate | p50 | p95 |')
  lines.push('|---|---|---|---|---|---|---|---|')
  for (const row of rows) {
    lines.push(
      `| \`${escapeMdCell(row.server)}\` | ${fmt(row.health)} | **${row.grade}** | ${row.calls} | ${row.errors} | ${pct(row.errorRate)} | ${
        row.p50Ms === null ? '—' : `${row.p50Ms}ms`
      } | ${row.p95Ms === null ? '—' : `${row.p95Ms}ms`} |`,
    )
  }
  const advice = report.mcpAdvice ?? []
  if (advice.length > 0) {
    lines.push('')
    lines.push('### MCP fixes')
    lines.push('')
    for (const item of advice.slice(0, 6)) {
      lines.push(`${SEV_ICON[item.severity] ?? '•'} **${item.title}** — ${item.evidence}`)
      lines.push(`   ↳ fix: ${item.fix}`)
    }
  }

  const failing = rows.flatMap((row) =>
    row.tools.filter((tool) => tool.errors > 0).map((tool) => ({ server: row.server, ...tool })),
  )
  if (failing.length > 0) {
    lines.push('')
    lines.push('### Tools with errors')
    lines.push('')
    for (const tool of failing.slice(0, 8)) {
      lines.push(
        `- \`${escapeMdCell(tool.server)}/${escapeMdCell(tool.tool)}\` — ${tool.errors}/${tool.calls} failed (${pct(tool.errorRate)}) · p95 ${
          tool.p95Ms === null || tool.p95Ms === undefined ? '—' : `${tool.p95Ms}ms`
        }`,
      )
    }
  }
  // Use the same configured threshold advice.buildMcpAdvice uses; fall back to
  // its default only when an older payload does not carry mcp.toolP95Ms.
  const configuredToolP95 = Number(report.mcp?.toolP95Ms)
  const slowToolP95Ms = Number.isFinite(configuredToolP95) && configuredToolP95 > 0 ? configuredToolP95 : 5000
  const slow = rows
    .flatMap((row) =>
      row.tools
        .filter((tool) => typeof tool.p95Ms === 'number' && tool.p95Ms > slowToolP95Ms)
        .map((tool) => ({ server: row.server, ...tool })),
    )
    .sort((a, b) => (b.p95Ms ?? 0) - (a.p95Ms ?? 0))
  if (slow.length > 0) {
    lines.push('')
    lines.push('### Slowest tools (p95)')
    lines.push('')
    for (const tool of slow.slice(0, 8)) {
      lines.push(
        `- \`${escapeMdCell(tool.server)}/${escapeMdCell(tool.tool)}\` — p50 ${tool.p50Ms ?? '—'}ms · p95 ${tool.p95Ms}ms · ${tool.calls} call(s)`,
      )
    }
  }
  return lines.join('\n')
}

export function renderRunsMarkdown(report: Pick<Report, 'runs'>): string {
  const rows = report.runs ?? []
  const lines = ['## Recent runs', '']
  if (rows.length === 0) {
    lines.push('No runs recorded yet.')
    return lines.join('\n')
  }
  lines.push('| session | score | grade | confidence | loads | calls | errors | corrections | mcp | skills |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const run of rows.slice(0, 12)) {
    lines.push(
      `| \`${run.sessionId.slice(-8)}\` | ${fmt(run.score?.total)}${
        run.score?.ci ? ` (${fmt(run.score.ci.low, 0)}–${fmt(run.score.ci.high, 0)})` : ''
      } | **${run.score?.grade ?? '—'}** | ${
        run.score?.confidence ?? '—'
      } | ${run.loads} | ${run.toolCalls} | ${run.errors} | ${run.corrections} | ${run.mcpCalls}/${run.mcpErrors} | ${run.skills
        .slice(0, 3)
        .map((s) => `\`${s}\``)
        .join(', ')} |`,
    )
  }
  return lines.join('\n')
}

export function renderStandardMarkdown(report: { scoring?: Partial<Report['scoring']> | null }): string {
  const scoring = report.scoring ?? {}
  const weights: Record<string, number> = scoring.weightsPercent ?? {}
  const th: Partial<Report['scoring']['thresholds']> = scoring.thresholds ?? {}
  return [
    '## Grading standard',
    '',
    `- weights: static ${weights.static ?? '—'} · reliability ${weights.reliability ?? '—'} · effectiveness ${
      weights.effectiveness ?? '—'
    } · efficiency ${weights.efficiency ?? '—'} (normalised to 100%)`,
    `- grade floors: A≥${th.excellent ?? 90} · B≥${th.good ?? 80} · C≥${th.pass ?? 70} · D≥60 · F<60`,
    `- minimum samples before a score stops being provisional: ${scoring.minSamples ?? '—'}`,
    '',
    'Change them in the plugin config; a weight of 0 drops that dimension.',
    '',
    '```yaml',
    'config:',
    `  weights: {static: ${weights.static ?? 30}, reliability: ${weights.reliability ?? 25}, effectiveness: ${
      weights.effectiveness ?? 30
    }, efficiency: ${weights.efficiency ?? 15}}`,
    `  thresholds: {excellent: ${th.excellent ?? 90}, good: ${th.good ?? 80}, pass: ${th.pass ?? 70}}`,
    `  minSamples: ${scoring.minSamples ?? 3}`,
    '```',
    '',
    'Paste that block into the profile entry for `dsh-skill-eval` (Plugins → Skill eval → config),',
    'or add it under the matching `id` in the profile `cordis.patch.yml`.',
  ].join('\n')
}

export function renderSummaryMarkdown(report: Report): string {
  const lines: string[] = []
  lines.push('## Skill execution report')
  lines.push('')
  lines.push(
    `recorded **${report.totals.invocations}** skill load(s) across **${report.totals.skills}** skill(s) · ${report.totals.closed} closed window(s) · data: \`${report.dataDir}\``,
  )
  lines.push('')
  if (report.skills.length === 0) {
    lines.push('No skill loads recorded yet. The plugin only sees loads that go through the `skill` tool.')
    return lines.join('\n')
  }
  lines.push('| skill | score | grade | static | reliab. | effect. | effic. | loads | corr. | abandon |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const s of report.skills) {
    lines.push(
      `| \`${escapeMdCell(s.skill)}\` | ${fmt(s.score.total)}${s.score.provisional ? '*' : ''}${
        s.score.ci ? ` (${fmt(s.score.ci.low, 0)}–${fmt(s.score.ci.high, 0)})` : ''
      } | **${s.score.grade}** | ${fmt(
        s.score.dimensions.static,
      )} | ${fmt(s.score.dimensions.reliability)} | ${fmt(s.score.dimensions.effectiveness)} | ${fmt(
        s.score.dimensions.efficiency,
      )} | ${s.stats.loads} | ${pct(s.stats.correctionRate)} | ${pct(s.stats.abandonRate)} |`,
    )
  }
  lines.push('')
  if (report.scoring) {
    const pctWeights: Record<string, number> = report.scoring.weightsPercent || {}
    const th: Partial<Report['scoring']['thresholds']> = report.scoring.thresholds || {}
    lines.push(
      `scoring: static ${pctWeights.static ?? '—'} · reliability ${pctWeights.reliability ?? '—'} · effectiveness ${
        pctWeights.effectiveness ?? '—'
      } · efficiency ${pctWeights.efficiency ?? '—'} | A≥${th.excellent ?? 90} B≥${th.good ?? 80} C≥${th.pass ?? 70}`,
    )
    lines.push('')
  }
  lines.push('`*` = provisional (fewer loads than the configured minimum).')
  if (report.ranking && report.ranking.note) {
    lines.push('')
    lines.push(`> ${report.ranking.note}`)
  }
  lines.push('')
  if ((report.mcpServers ?? []).length > 0) {
    lines.push('### MCP servers')
    lines.push('')
    lines.push('| server | health | grade | calls | errors | p50 | p95 |')
    lines.push('|---|---|---|---|---|---|---|')
    for (const row of report.mcpServers) {
      lines.push(
        `| \`${row.server}\` | ${fmt(row.health)} | **${row.grade}** | ${row.calls} | ${pct(row.errorRate)} | ${
          row.p50Ms === null ? '—' : `${row.p50Ms}ms`
        } | ${row.p95Ms === null ? '—' : `${row.p95Ms}ms`} |`,
      )
    }
    for (const item of (report.mcpAdvice ?? []).slice(0, 4)) {
      lines.push(`${SEV_ICON[item.severity] ?? '•'} ${item.title} — ${item.evidence}`)
    }
    lines.push('')
  }

  if ((report.runs ?? []).length > 0) {
    lines.push('### Recent runs')
    lines.push('')
    lines.push('| session | score | grade | loads | calls | errors | corrections | skills |')
    lines.push('|---|---|---|---|---|---|---|---|')
    for (const run of report.runs.slice(0, 8)) {
      lines.push(
        `| \`${escapeMdCell(String(run.sessionId).slice(-8))}\` | ${fmt(run.score?.total)} | **${run.score?.grade ?? '—'}** | ${run.loads} | ${
          run.toolCalls
        } | ${run.errors} | ${run.corrections} | ${run.skills
          .slice(0, 3)
          .map((s) => `\`${escapeMdCell(s)}\``)
          .join(', ')} |`,
      )
    }
    lines.push('')
  }

  const flagged = report.skills.filter((s) => s.topAdvice.length > 0).slice(0, 5)
  if (flagged.length > 0) {
    lines.push('### Highest-value fixes')
    lines.push('')
    for (const s of flagged) {
      lines.push(`**\`${escapeMdCell(s.skill)}\`** — ${fmt(s.score.total)}/100 (${s.score.grade})`)
      if (typeof s.adviceBudget === 'number') {
        lines.push(`_edit budget: ${s.adviceBudget} concurrent change(s) this round_`)
      }
      if (s.exploration) {
        lines.push(`_exploration: ${s.exploration.reason} → next change should target \`${s.exploration.suggestion}\`_`)
      }
      for (const a of s.topAdvice) {
        lines.push(`${SEV_ICON[a.severity] ?? '•'} **${a.title}** — ${a.evidence}`)
        lines.push(`   ↳ fix: ${a.fix}`)
      }
      lines.push('')
    }
  }
  return lines.join('\n')
}

export function renderSkillMarkdown(entry: SkillEntry): string {
  const lines: string[] = []
  lines.push(`## \`${escapeMdCell(entry.skill)}\` — ${fmt(entry.score.total)}/100 (${entry.score.grade})`)
  lines.push('')
  if (entry.score.ci) {
    lines.push(
      `95% confidence interval: **${fmt(entry.score.ci.low)} – ${fmt(entry.score.ci.high)}** (${entry.score.ci.resamples} bootstrap resamples over ${entry.score.samples} load(s))`,
    )
  }
  if (entry.score.provisional) lines.push('> provisional score: not enough recorded loads yet')
  lines.push('')
  lines.push(`static quality   ${bar(entry.score.dimensions.static)}  ${fmt(entry.score.dimensions.static)}`)
  lines.push(`reliability      ${bar(entry.score.dimensions.reliability)}  ${fmt(entry.score.dimensions.reliability)}`)
  lines.push(
    `effectiveness    ${bar(entry.score.dimensions.effectiveness)}  ${fmt(entry.score.dimensions.effectiveness)}`,
  )
  lines.push(`efficiency       ${bar(entry.score.dimensions.efficiency)}  ${fmt(entry.score.dimensions.efficiency)}`)
  lines.push('')
  lines.push('### measured')
  lines.push('')
  lines.push(`- loads: ${entry.stats.loads} (${entry.stats.closed} closed window(s), ${entry.stats.open} open)`)
  lines.push(`- load success: ${pct(entry.stats.loadOkRate)}`)
  lines.push(`- tool calls in window: ${entry.stats.toolCalls} total, avg ${fmt(entry.stats.avgCalls)}`)
  lines.push(`- post-load tool error rate: ${pct(entry.stats.errRate)}`)
  lines.push(`- user correction rate: ${pct(entry.stats.correctionRate)}`)
  lines.push(`- ignored-after-load rate: ${pct(entry.stats.abandonRate)}`)
  lines.push(`- sibling skill loaded in same window: ${pct(entry.stats.siblingRate)}`)
  lines.push(`- median load time: ${fmt(entry.stats.p50LoadMs, 0)} ms`)
  if (entry.stats.feedbackTotal > 0) {
    lines.push(
      `- explicit feedback: +${entry.stats.feedback.positive} / -${entry.stats.feedback.negative} (${pct(
        entry.stats.feedbackNegativeRate,
      )} negative)`,
    )
  }
  const outcomes = entry.stats.outcomes
  const produced =
    (outcomes?.deliverables ?? 0) +
    (outcomes?.workspaceChanges ?? 0) +
    (outcomes?.jobsSettled ?? 0) +
    (outcomes?.tasksCompleted ?? 0) +
    (outcomes?.workflowRuns ?? 0)
  if (produced > 0) {
    lines.push(
      `- outcome evidence: ${outcomes.deliverables} deliverable(s), ${outcomes.workspaceChanges} workspace change(s), ${outcomes.jobsSettled} settled job(s), ${outcomes.tasksCompleted} completed task(s)`,
    )
  }
  if (entry.stats.approvals.asked > 0 || entry.stats.approvals.rejected > 0) {
    lines.push(
      `- approvals: ${entry.stats.approvals.asked} asked, ${entry.stats.approvals.rejected} rejected of ${entry.stats.approvals.decided} decided`,
    )
  }
  if (entry.stats.compactions > 0) {
    lines.push(`- context compactions: ${entry.stats.compactions} in ${entry.stats.compactionWindows} window(s)`)
  }
  const modelKeys = Object.keys(entry.stats.models ?? {})
  if (modelKeys.length > 0) {
    lines.push(`- models observed: ${modelKeys.slice(0, 3).join(', ')}`)
  }
  const presetKeys = Object.keys(entry.stats.presets ?? {})
  if (presetKeys.length > 0) lines.push(`- presets observed: ${presetKeys.slice(0, 3).join(', ')}`)
  if (entry.staticQuality) {
    lines.push('')
    lines.push(
      `### authoring (static ${fmt(entry.staticQuality.score)}/100, ${entry.staticQuality.bodyLines} body lines, ${entry.staticQuality.source ?? 'unknown source'})`,
    )
    for (const c of entry.staticQuality.checks ?? []) {
      if ((c.fraction ?? 0) >= 1) continue
      lines.push(`- ✗ ${c.label} (${c.points}/${c.weight})`)
    }
  }
  lines.push('')
  lines.push('### advice')
  lines.push('')
  if (entry.advice.length === 0) lines.push('Nothing to fix from the recorded evidence.')
  for (const a of entry.advice) {
    lines.push(`${SEV_ICON[a.severity] ?? '•'} **[${a.severity}] ${a.title}** (${a.dimension})`)
    lines.push(`   evidence: ${a.evidence}`)
    lines.push(`   fix: ${a.fix}`)
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// HTML dashboard
// ---------------------------------------------------------------------------

function scoreColor(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '#666'
  if (v >= 90) return '#2f9e44'
  if (v >= 80) return '#5c9e2f'
  if (v >= 70) return '#c9a227'
  if (v >= 60) return '#d97706'
  return '#c92a2a'
}

function adviceBlock(title: string, items: readonly Advice[] | null | undefined): string {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return ''
  const rows = list
    .slice(0, 6)
    .map(
      (item) =>
        `<li style="border-left:3px solid ${item.severity === 'critical' ? 'var(--dsw-alias-state-error-primary, #c92a2a)' : 'var(--dsw-alias-state-warn-primary, #d97706)'};padding-left:9px;margin-bottom:8px"><b>${esc(
          item.title,
        )}</b><div class="sub">${esc(item.evidence)}</div><div>↳ ${esc(item.fix)}</div></li>`,
    )
    .join('')
  return `<section class="block"><h2>${esc(title)}</h2><ul style="list-style:none;padding:0;margin:0;font-size:12px">${rows}</ul></section>`
}

function tableSection(title: string, headers: readonly string[], rows: readonly string[][]): string {
  if (rows.length === 0) return ''
  const head = headers.map((h) => `<th>${esc(h)}</th>`).join('')
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells.map((cell, index) => `<td${index === 0 ? ' class="first"' : ''}>${cell}</td>`).join('')}</tr>`,
    )
    .join('')
  return `<section class="block"><h2>${esc(title)}</h2><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></section>`
}

/** Pick a language from an explicit ?lang=, then Accept-Language, defaulting to English. */
export function resolveLang(acceptLanguage: unknown, explicit: unknown): 'zh' | 'en' {
  const explicitLang = typeof explicit === 'string' ? explicit.toLowerCase() : ''
  if (explicitLang.startsWith('zh')) return 'zh'
  if (explicitLang.startsWith('en')) return 'en'
  const header = typeof acceptLanguage === 'string' ? acceptLanguage.toLowerCase() : ''
  if (header.includes('zh')) return 'zh'
  if (header.includes('en')) return 'en'
  return 'en'
}

type Validity = ReturnType<typeof buildValidity>

interface BoardText {
  lang: string
  title: string
  config: string
  scoring: string
  loadsLine: (r: Report) => string
  noSkills: string
  dims: Record<string, string>
  meta: (s: SkillEntry) => string
  noIssues: string
  nextTitle: string
  priority: string
  budget: string
  nextEmpty: string
  evidenceTitle: string
  coverage: (v: Validity) => string
  canSay: string
  cannotSay: string
  ledgerTitle: string
  ledgerHead: string[]
  mcpTitle: string
  mcpHead: string[]
  mcpFixes: string
  runsTitle: string
  runsHead: string[]
  toggle: (other: string, label: string) => string
}

const BOARD: Record<'en' | 'zh', BoardText> = {
  en: {
    lang: 'en',
    title: 'Skill execution report',
    config: '⚙ Settings',
    scoring: 'scoring',
    loadsLine: (r) =>
      `${r.totals.invocations} load(s) · ${r.totals.skills} skill(s) · ${r.totals.closed} closed window(s) · generated ${r.generatedAt}`,
    noSkills: 'No skill loads recorded yet.',
    dims: { static: 'static', reliability: 'reliability', effectiveness: 'effectiveness', efficiency: 'efficiency' },
    meta: (s) =>
      `${s.stats.loads} load(s) · corr ${pct(s.stats.correctionRate)} · abandon ${pct(s.stats.abandonRate)} · err ${pct(
        s.stats.errRate,
      )} · ${fmt(s.stats.p50LoadMs, 0)}ms`,
    noIssues: 'no issues from recorded evidence',
    nextTitle: 'Next steps (ranked by expected gain / effort)',
    priority: 'priority',
    budget: 'budget',
    nextEmpty: 'No skill currently has an actionable fix within budget.',
    evidenceTitle: 'What the evidence supports',
    coverage: (v) =>
      `coverage: ${v.coverage.skills} skill(s) · ${v.coverage.withCI} with 95% intervals · ${v.coverage.provisional} provisional · ranking ${
        v.ranking.unknown ? 'not enough evidence' : v.ranking.significant ? 'significant' : 'not significant'
      }`,
    canSay: 'Can say',
    cannotSay: 'Cannot say yet',
    ledgerTitle: 'Screened edits',
    ledgerHead: ['at', 'skill', 'dimension', 'verdict', 'hypothesis'],
    mcpTitle: 'MCP servers',
    mcpHead: ['server', 'health', 'grade', 'calls', 'errors', 'p50', 'p95'],
    mcpFixes: 'MCP fixes',
    runsTitle: 'Recent runs',
    runsHead: ['session', 'score', 'grade', 'loads', 'calls', 'errors', 'corrections', 'skills'],
    toggle: (other, label) => `<a href="?lang=${other}">${label}</a>`,
  },
  zh: {
    lang: 'zh',
    title: '技能执行报告',
    config: '⚙ 配置',
    scoring: '评分',
    loadsLine: (r) =>
      `${r.totals.invocations} 次加载 · ${r.totals.skills} 个技能 · ${r.totals.closed} 个已结算窗口 · 生成于 ${r.generatedAt}`,
    noSkills: '还没有记录到技能加载。',
    dims: {
      static: '静态质量',
      reliability: '可靠性',
      effectiveness: '有效性',
      efficiency: '效率',
      lifecycle: '生命周期',
      mcp: 'MCP',
    },
    meta: (s) =>
      `${s.stats.loads} 次加载 · 纠正 ${pct(s.stats.correctionRate)} · 忽略 ${pct(s.stats.abandonRate)} · 报错 ${pct(
        s.stats.errRate,
      )} · ${fmt(s.stats.p50LoadMs, 0)}ms`,
    noIssues: '按现有证据没有需要修的问题',
    nextTitle: '下一步（按预期收益 / 成本排序）',
    priority: '优先级',
    budget: '预算',
    nextEmpty: '当前没有在预算内有可行动修复的技能。',
    evidenceTitle: '证据能支持什么',
    coverage: (v) =>
      `覆盖：${v.coverage.skills} 个技能 · ${v.coverage.withCI} 个有 95% 区间 · ${v.coverage.provisional} 个临时分 · 排名${
        v.ranking.unknown ? '证据不足' : v.ranking.significant ? '显著' : '不显著'
      }`,
    canSay: '可以断言',
    cannotSay: '还不能断言',
    ledgerTitle: '已审查的改动',
    ledgerHead: ['时间', '技能', '维度', '裁决', '假设'],
    mcpTitle: 'MCP 服务器',
    mcpHead: ['服务器', '健康度', '等级', '调用', '错误', 'p50', 'p95'],
    mcpFixes: 'MCP 修复建议',
    runsTitle: '最近运行',
    runsHead: ['会话', '评分', '等级', '加载', '调用', '错误', '纠正', '技能'],
    toggle: (other, label) => `<a href="?lang=${other}">${label}</a>`,
  },
}

export function renderHtml(input: Report, options: { lang?: string; base?: string } = {}): string {
  const lang = options.lang === 'zh' ? 'zh' : 'en'
  const report = localizeReport(input, lang)
  const t = BOARD[lang]
  const rows = report.skills
    .map((s) => {
      const d = s.score.dimensions
      const cells = (
        [
          ['static', d.static],
          ['reliability', d.reliability],
          ['effectiveness', d.effectiveness],
          ['efficiency', d.efficiency],
        ] as Array<[string, number | null]>
      )
        .map(
          ([label, v]) =>
            `<div class="dim"><span>${esc(t.dims[label] ?? label)}</span><i style="width:${v !== null && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0}%;background:${scoreColor(v)}"></i><b>${fmt(v)}</b></div>`,
        )
        .join('')
      const advice = s.advice
        .slice(0, 4)
        .map(
          (a) =>
            `<li class="sev-${esc(a.severity)}"><b>${esc(a.title)}</b><span>${esc(a.evidence)}</span><em>${esc(a.fix)}</em></li>`,
        )
        .join('')
      return `<article class="card">
  <header>
    <div class="name">${esc(s.skill)}</div>
    <div class="grade" style="color:${scoreColor(s.score.total)}">${esc(s.score.grade)}</div>
    <div class="total" style="color:${scoreColor(s.score.total)}">${fmt(s.score.total)}${s.score.provisional ? '<sup>*</sup>' : ''}</div>
  </header>
  <div class="dims">${cells}</div>
  <div class="meta">${esc(t.meta(s))}</div>
  ${advice ? `<ul class="advice">${advice}</ul>` : `<div class="meta">${esc(t.noIssues)}</div>`}
</article>`
    })
    .join('\n')

  const validity = report.validity ?? null
  // Plans are computed once in the analyzer and shipped with the report, so
  // this pure renderer never invokes the planner. Older payloads without the
  // field fall back to the empty state.
  const plans = (report.loopPlans ?? []).slice(0, 3)
  const nextSteps = plans.length
    ? `<div class="block"><h2>${esc(t.nextTitle)}</h2><ol class="steps">${plans
        .map(
          (plan) =>
            `<li><b>${esc(plan.skill)}</b> — ${esc(t.priority)} ${plan.priority?.score ?? '—'} · ${esc(t.budget)} ${plan.budget}<br><span>${esc(
              plan.chosen[0]?.title ?? '',
            )}</span> <em>${esc(plan.chosen[0]?.fix ?? '')}</em></li>`,
        )
        .join('')}</ol></div>`
    : `<div class="block"><h2>${esc(t.nextTitle)}</h2><div class="sub">${esc(t.nextEmpty)}</div></div>`
  const evidence = validity
    ? `<div class="block"><h2>${esc(t.evidenceTitle)}</h2>
<div class="sub">${esc(t.coverage(validity))}</div>
<ul class="evidence"><li><b>${esc(t.canSay)}</b><ul>${validity.canSay.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></li>
<li><b>${esc(t.cannotSay)}</b><ul>${validity.cannotSay.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></li></ul></div>`
    : ''
  const editRows = (report.edits ?? [])
    .slice(0, 8)
    .map((edit) => [
      esc(formatTimestamp(edit.at)),
      esc(edit.skill ?? ''),
      esc(edit.dimension ?? '—'),
      `<b>${esc(edit.verdict ?? '')}</b>`,
      esc(String(edit.hypothesis ?? '').slice(0, 70)),
    ])
  const ledgerBlock = tableSection(t.ledgerTitle, t.ledgerHead, editRows)
  const otherLang = lang === 'zh' ? 'en' : 'zh'
  const toggle = options.base
    ? `<div class="sub">${t.config ? `<a href="${esc(options.base)}/config">${esc(t.config)}</a> · ` : ''}${t.toggle(
        otherLang,
        otherLang === 'zh' ? '中文' : 'English',
      )}</div>`
    : ''
  const scoringLine = report.scoring
    ? `${t.scoring}: ${Object.entries(report.scoring.weightsPercent || {})
        .map(([k, v]) => `${k} ${v}`)
        .join(' · ')} | A≥${report.scoring.thresholds?.excellent ?? 90} B≥${report.scoring.thresholds?.good ?? 80} C≥${
        report.scoring.thresholds?.pass ?? 70
      }`
    : ''

  return `<!doctype html>
<html lang="${t.lang}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Skill eval</title>
<style>
:root{color-scheme:light dark}
body{margin:0;padding:28px;font:14px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;background:#fafafa;color:#18181b}
@media (prefers-color-scheme:dark){body{background:#111113;color:#e7e7ea}.card{background:#1a1a1e!important;border-color:#2a2a30!important}.meta{color:#8f8f9a}}
h1{font-size:19px;margin:0 0 4px}
.sub{color:#71717a;margin-bottom:22px;font-size:12px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(360px,1fr))}
.card{background:#fff;border:1px solid #e5e5e9;border-radius:12px;padding:16px}
header{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.name{font-weight:600;font-size:15px;flex:1;word-break:break-all}
.grade{font-weight:700;font-size:18px}
.total{font-variant-numeric:tabular-nums;font-weight:600}
.dims{display:grid;gap:5px;margin-bottom:10px}
.dim{display:grid;grid-template-columns:98px 1fr 38px;align-items:center;gap:8px;font-size:11px;color:#71717a}
.dim i{display:block;height:6px;border-radius:3px;background:#ddd;min-width:2px}
.dim b{text-align:right;font-variant-numeric:tabular-nums;color:#3f3f46}
@media (prefers-color-scheme:dark){.dim b{color:#c9c9d1}}
.meta{font-size:11px;color:#8f8f9a;margin-bottom:8px}
.advice{list-style:none;padding:0;margin:0;display:grid;gap:7px}
.advice li{font-size:12px;padding-left:9px;border-left:3px solid #d4d4d8}
.advice li b{display:block}
.advice li span{display:block;color:#71717a;font-size:11px}
.advice li em{display:block;font-style:normal;font-size:11px;color:#3f3f46;margin-top:2px}
.advice .sev-critical{border-color:#c92a2a}
.advice .sev-warning{border-color:#d97706}
.advice .sev-info{border-color:#3b82f6}
@media (prefers-color-scheme:dark){.advice li em{color:#c9c9d1}}
.block{margin-top:26px}
.block h2{font-size:14px;margin:0 0 8px}
.block table{border-collapse:collapse;width:100%;font-size:12px}
.block th{text-align:left;font-weight:600;color:#71717a;border-bottom:1px solid #e5e5e9;padding:6px 8px}
.block td{border-bottom:1px solid #f0f0f2;padding:6px 8px;font-variant-numeric:tabular-nums}
.block td.first{font-weight:600}
.steps{margin:0;padding-left:20px;display:grid;gap:10px;font-size:12px}
.steps b{font-weight:600}
.steps span{color:#3f3f46}
.steps em{font-style:normal;color:#71717a;font-size:11px;display:block;margin-top:2px}
.evidence{list-style:none;padding:0;margin:0;display:grid;gap:10px;font-size:12px}
.evidence > li > b{display:block;margin-bottom:3px}
.evidence ul{margin:0;padding-left:18px;color:#52525b;font-size:11.5px}
@media (prefers-color-scheme:dark){.steps span,.evidence ul{color:#c9c9d1}}
@media (prefers-color-scheme:dark){.block th{border-color:#2a2a30}.block td{border-color:#232329}}
</style></head>
<body>
<h1>${esc(t.title)}</h1>
${toggle}
<div class="sub">${esc(scoringLine)}</div>
<div class="sub">${esc(t.loadsLine(report))} · <code>${esc(report.dataDir)}</code></div>
<div class="grid">
${rows || `<div class="sub">${esc(t.noSkills)}</div>`}
</div>
${nextSteps}
${evidence}
${ledgerBlock}
${tableSection(
  t.mcpTitle,
  t.mcpHead,
  (report.mcpServers ?? []).map((row) => [
    esc(row.server),
    fmt(row.health),
    `<b style="color:${scoreColor(row.health)}">${esc(row.grade)}</b>`,
    String(row.calls),
    pct(row.errorRate),
    row.p50Ms === null ? '—' : `${row.p50Ms}ms`,
    row.p95Ms === null ? '—' : `${row.p95Ms}ms`,
  ]),
)}
${adviceBlock(t.mcpFixes, report.mcpAdvice)}
${tableSection(
  t.runsTitle,
  t.runsHead,
  (report.runs ?? [])
    .slice(0, 12)
    .map((run) => [
      esc(run.sessionId.slice(-8)),
      fmt(run.score?.total),
      `<b style="color:${scoreColor(run.score?.total)}">${esc(run.score?.grade ?? '—')}</b>`,
      String(run.loads),
      String(run.toolCalls),
      String(run.errors),
      String(run.corrections),
      esc(run.skills.slice(0, 3).join(', ')),
    ]),
)}
</body></html>`
}
