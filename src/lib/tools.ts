/**
 * Agent-facing report surface: `skill_eval_report` tool parameters, the view
 * dispatcher (summary/mcp/runs/standard/loop/validity/history/impact/dev/turns)
 * and the review-tool leakage screen. Moved out of index.ts so the entry keeps
 * only plugin wiring; behavior is unchanged.
 */
import path from 'node:path'
import type { checkInProcessReport } from './accept.ts'
import { reviewSkillEdit } from './critic.ts'
import { buildLoopPlan, buildLoopPlans, renderLoopBatchMarkdown, renderLoopMarkdown } from './loop.ts'
import { buildDevReport, renderDevMarkdown } from './dev.ts'
import { buildHistory, buildImpact, renderHistoryMarkdown, renderImpactMarkdown } from './history.ts'
import { hashHex } from './random.ts'
import { listTurnReports, renderTurnReportsMarkdown } from './snapshot.ts'
import {
  renderMcpMarkdown,
  renderRunsMarkdown,
  renderSkillMarkdown,
  renderStandardMarkdown,
  renderSummaryMarkdown,
} from './render.ts'
import { renderValidityMarkdown } from './validity.ts'
import type { Analyzer } from './report.ts'
import type { Json } from './types.ts'

export const REPORT_PARAMETERS = {
  type: 'object',
  properties: {
    skill: {
      type: 'string',
      description: 'report a single skill by name; omit for the cross-skill summary',
    },
    format: {
      type: 'string',
      enum: ['markdown', 'json'],
      description: 'markdown (default) for humans and models, json for post-processing',
    },
    all: {
      type: 'boolean',
      description: 'with view:"loop": return the plan for every skill that has an actionable fix',
    },
    view: {
      type: 'string',
      enum: ['summary', 'mcp', 'runs', 'standard', 'loop', 'validity', 'history', 'impact', 'dev', 'turns'],
      description:
        'summary (default) scores every skill; mcp debugs MCP servers; runs lists recent sessions; standard shows the grading configuration; loop shows the next guided optimization step (add all:true for every actionable skill)',
    },
  },
  additionalProperties: false,
}

export const REPORT_OUTPUT = {
  schema: { type: 'string', description: 'markdown or JSON report text' },
  render(_args: unknown, value: unknown) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
  },
}

export const VIEWS = ['summary', 'mcp', 'runs', 'standard', 'loop', 'validity', 'history', 'impact', 'dev', 'turns']

export interface ReportArgs {
  view?: string
  skill?: unknown
  format?: string
  all?: boolean
}

export interface ReportDiagnostics {
  settingsFile: string | null
  settings: Record<string, unknown>
  settingsErrors: Array<{ key?: string } | { key: string; message: string }>
  routes: string[]
  tools: string[]
  inspectProvider: boolean
  warnings: string[]
}

export interface ReportDeps {
  manifestUrl: () => URL
  moduleVersion: string | null
  diagnostics: ReportDiagnostics
}

/** Read the files the acceptance check needs, best effort. */
export async function acceptanceFiles(
  store: { dir: string },
  readFile: (file: string, encoding: 'utf8') => Promise<string>,
  snapshotDir = path.join(store.dir, 'reports'),
) {
  const dir = store.dir
  const eventsPath = path.join(dir, 'events.jsonl')
  const snapshotMarkdownPath = path.join(snapshotDir, 'latest.md')
  const snapshotJsonPath = path.join(snapshotDir, 'latest.json')
  let events: Json[] = []
  try {
    const raw = await readFile(eventsPath, 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        events.push(JSON.parse(trimmed))
      } catch {
        // torn write
      }
    }
  } catch {
    events = []
  }
  const optional = async (file: string) => {
    try {
      return await readFile(file, 'utf8')
    } catch {
      return null
    }
  }
  return {
    eventsPath,
    snapshotMarkdownPath,
    snapshotJsonPath,
    events,
    snapshotText: await optional(snapshotMarkdownPath),
    snapshotJsonText: await optional(snapshotJsonPath),
  }
}

export function renderAcceptance(acceptance: ReturnType<typeof checkInProcessReport>): string {
  const lines = ['## In-process acceptance', '']
  for (const item of acceptance.results) {
    const mark = item.skipped ? 'SKIP' : item.ok ? 'PASS' : 'FAIL'
    lines.push(`- **${mark}** \`${item.id}\` — ${item.detail}`)
  }
  lines.push('', acceptance.summary)
  return lines.join('\n')
}

export async function runReport(
  analyzer: Analyzer,
  args: ReportArgs,
  config: {
    reportDir?: unknown
    maxAdvice?: number
    editBudgetMax?: number
    pruneMinLoads?: number
  },
  deps: ReportDeps,
): Promise<string> {
  const format = args?.format === 'json' ? 'json' : 'markdown'
  const view = args?.view && VIEWS.includes(args.view) ? args.view : 'summary'
  if (view === 'turns') {
    const reportsDir = config.reportDir ? String(config.reportDir) : path.join(analyzer.store.dir, 'reports')
    const rows = await listTurnReports(reportsDir)
    return format === 'json' ? JSON.stringify({ turns: rows }, null, 2) : renderTurnReportsMarkdown(rows)
  }
  if (view === 'dev') {
    const records = await analyzer.store.readAll()
    const diskVersion = await import('node:fs/promises').then((fs) => fs.readFile(deps.manifestUrl(), 'utf8'))
    let parsedDiskVersion: string | null
    try {
      parsedDiskVersion = JSON.parse(diskVersion).version ?? null
    } catch {
      parsedDiskVersion = null
    }
    const dev = buildDevReport({
      moduleVersion: deps.moduleVersion,
      diskVersion: parsedDiskVersion,
      dataDir: analyzer.store.dir,
      settingsFile: deps.diagnostics.settingsFile,
      settings: deps.diagnostics.settings,
      settingsErrors: deps.diagnostics.settingsErrors,
      config: {
        weights: (config as Record<string, unknown>).weights,
        thresholds: (config as Record<string, unknown>).thresholds,
        minSamples: (config as Record<string, unknown>).minSamples,
        tokenBudgetPerLoad: (config as Record<string, unknown>).tokenBudgetPerLoad,
        adviceNoiseFloor: (config as Record<string, unknown>).adviceNoiseFloor,
      },
      routes: deps.diagnostics.routes,
      records,
      store: { dir: analyzer.store.dir, failed: analyzer.store.failed, queued: analyzer.store.pending },
      tools: deps.diagnostics.tools,
      inspectProvider: deps.diagnostics.inspectProvider ? 'skill-eval' : null,
      warnings: deps.diagnostics.warnings,
    })
    return format === 'json' ? JSON.stringify(dev, null, 2) : renderDevMarkdown(dev)
  }
  if (view === 'history' || view === 'impact') {
    const skill = typeof args?.skill === 'string' ? args.skill : ''
    if (!skill) return `view:"${view}" needs a skill name, e.g. {"view":"${view}","skill":"pdf-tools"}`
    const records = await analyzer.store.readAll()
    if (view === 'history') {
      const history = buildHistory(records, skill)
      return format === 'json' ? JSON.stringify(history, null, 2) : renderHistoryMarkdown(history)
    }
    const impact = buildImpact(records, skill)
    return format === 'json' ? JSON.stringify(impact, null, 2) : renderImpactMarkdown(impact)
  }
  if (view === 'validity') {
    const report = await analyzer.build()
    return format === 'json' ? JSON.stringify(report.validity, null, 2) : renderValidityMarkdown(report.validity)
  }
  if (view === 'loop') {
    const report = await analyzer.build()
    if (args?.all === true || args?.skill === 'all') {
      const plans = buildLoopPlans(report, {
        editBudgetMax: config.editBudgetMax ?? 4,
        reloads: report.scoring?.minSamples ?? 3,
      })
      return format === 'json' ? JSON.stringify({ plans }, null, 2) : renderLoopBatchMarkdown(plans)
    }
    const plan = buildLoopPlan(report, {
      skill: typeof args?.skill === 'string' ? args.skill : undefined,
      editBudgetMax: config.editBudgetMax ?? 4,
      reloads: report.scoring?.minSamples ?? 3,
    })
    return format === 'json' ? JSON.stringify(plan, null, 2) : renderLoopMarkdown(plan)
  }
  if (view === 'mcp' || view === 'runs' || view === 'standard') {
    const report = await analyzer.build()
    if (format === 'json') {
      return JSON.stringify(
        view === 'mcp'
          ? { mcpServers: report.mcpServers }
          : view === 'runs'
            ? { runs: report.runs }
            : { scoring: report.scoring },
        null,
        2,
      )
    }
    return view === 'mcp'
      ? renderMcpMarkdown(report)
      : view === 'runs'
        ? renderRunsMarkdown(report)
        : renderStandardMarkdown(report)
  }
  if (args?.skill) {
    const entry = await analyzer.buildOne(String(args.skill))
    if (!entry) {
      const known = (await analyzer.build()).skills.map((s) => s.skill)
      return `No evidence recorded for skill \`${args.skill}\`.\n\nSkills with recorded loads: ${
        known.length > 0 ? known.map((n) => `\`${n}\``).join(', ') : '(none)'
      }`
    }
    if (format === 'json') return JSON.stringify(entry, null, 2)
    return renderSkillMarkdown({ ...entry, advice: entry.advice })
  }
  const report = await analyzer.build()
  if (format === 'json') return JSON.stringify(report, null, 2)
  return renderSummaryMarkdown({
    ...report,
    skills: report.skills.map((s) => ({ ...s, topAdvice: s.topAdvice.slice(0, config.maxAdvice ?? 3) })),
  })
}

/** Screen a proposed skill edit and append the verdict to the audit ledger. */
export async function runReview(analyzer: Pick<Analyzer, 'store'>, args: Json): Promise<string> {
  try {
    const verdict = reviewSkillEdit({
      skill: String(args?.skill ?? ''),
      hypothesis: typeof args?.hypothesis === 'string' ? args.hypothesis : undefined,
      diff: typeof args?.diff === 'string' ? args.diff : undefined,
    })
    await analyzer.store.append({
      t: 'edit',
      v: 1,
      at: Date.now(),
      skill: String(args?.skill ?? ''),
      hypothesis: typeof args?.hypothesis === 'string' ? args.hypothesis.slice(0, 500) : '',
      verdict: verdict.verdict,
      dimension: typeof args?.dimension === 'string' ? args.dimension : null,
      reasons: verdict.reasons.map((reason) => reason.code),
      diffHash: typeof args?.diff === 'string' ? hashHex(args.diff) : null,
    })
    const lines = [`skill_eval_review: **${verdict.verdict}** for \`${args?.skill ?? ''}\``]
    if (verdict.reasons.length === 0) lines.push('no leakage signals found')
    for (const reason of verdict.reasons)
      lines.push(`- [${reason.severity}] ${reason.code}: ${reason.label} — ${reason.detail}`)
    return lines.join('\n')
  } catch (error) {
    return `skill_eval_review failed: ${error instanceof Error ? error.message : String(error)}`
  }
}
