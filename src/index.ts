/**
 * dsh-skill-eval — skill execution telemetry, scoring and optimization advice.
 *
 * Host-plane plugin. It records every `skill` tool load plus the stretch of work
 * that follows it, then scores each skill 0-100 on two axes:
 *
 *   - static authoring quality (description, trigger cues, progressive
 *     disclosure, size, examples) — computed from the live skill catalog
 *   - live execution evidence (load failures, post-load tool errors, user
 *     corrections, ignored loads, sibling collisions, cost) — folded from the
 *     append-only event store
 *
 * The result is exposed three ways: the `skill_eval_report` tool (so the agent
 * can read its own numbers and act on the cited fixes), a `/skill-eval` slash
 * command, and an HTML dashboard served by the host web server.
 *
 * @module dsh-skill-eval
 */
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import z from '@deepseek-ai/schemastery'
import { createAnalyzer } from './lib/report.ts'
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS } from './lib/score.ts'
import { createRecorder } from './lib/recorder.ts'
import type { ResolveSkill } from './lib/recorder.ts'
import { checkInProcessReport } from './lib/accept.ts'
import { reviewSkillEdit } from './lib/critic.ts'
import { buildLoopPlan, buildLoopPlans, renderLoopBatchMarkdown, renderLoopMarkdown } from './lib/loop.ts'
import { buildDevReport, renderDevMarkdown } from './lib/dev.ts'
import { buildHistory, buildImpact, renderHistoryMarkdown, renderImpactMarkdown } from './lib/history.ts'
import { resolveDataDir } from './lib/store.ts'
import { hashHex } from './lib/random.ts'
import {
  applySettings,
  FIELD_ZH,
  loadSettingsSync,
  normalizeSettings,
  parseFormSettings,
  renderConfigHtml,
  updateSettings,
  SETTINGS_FIELDS,
  SETTINGS_FILE,
} from './lib/settings.ts'
import { renderValidityMarkdown } from './lib/validity.ts'
import { createInspectProvider } from './lib/inspect.ts'
import { createSnapshots, listTurnReports, renderTurnReportsMarkdown } from './lib/snapshot.ts'
import {
  renderHtml,
  resolveLang,
  renderMcpMarkdown,
  renderRunsMarkdown,
  renderSkillMarkdown,
  renderStandardMarkdown,
  renderSummaryMarkdown,
} from './lib/render.ts'
import type { Analyzer } from './lib/report.ts'
import type { Host, Json } from './lib/types.ts'

export const name = 'skill-eval'

/**
 * Emitted `index.js` sits next to package.json. `src/index.ts` is one directory
 * down. Either layout has to find the same manifest, or the versioned routes
 * never register.
 */
function manifestUrl(): URL {
  const beside = new URL('./package.json', import.meta.url)
  return existsSync(beside) ? beside : new URL('../package.json', import.meta.url)
}

/**
 * The running package version. The data route is registered both canonically
 * and under this version, because a plugin reload cannot reclaim a route the
 * previous generation already registered: the versioned path is new on every
 * release, so a hot-reloaded plugin can still serve current data.
 */
function packageVersion(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(manifestUrl(), 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

const PLUGIN_VERSION = packageVersion()

/** Per-apply diagnostics surfaced by the `dev` view (the restart-skew detector). */
const DIAGNOSTICS: {
  routes: string[]
  tools: string[]
  inspectProvider: boolean
  warnings: string[]
  settingsFile: string | null
  settings: Record<string, unknown>
  settingsErrors: Array<{ key: string; message: string }>
} = {
  routes: [],
  tools: [],
  inspectProvider: false,
  warnings: [],
  settingsFile: null,
  settings: {},
  settingsErrors: [],
}

// cordis 4 resolves `inject` as an array or a name -> config map, with no
// required/optional split. Optional services are attached with `ctx.inject(...)`
// below, which starts the callback only once that service is available.
export const inject = ['tools', 'skills']

export const Config = z.object({
  enabled: z.boolean().default(true).description('record skill telemetry and expose the report tool'),
  dataDir: z.string().description('override the telemetry directory (default: $DSH_HOME/skill-eval/$DSH_PROFILE)'),
  windowToolCalls: z
    .natural()
    .min(1)
    .max(200)
    .default(12)
    .description('tool calls after a skill load that still count as evidence for that load'),
  windowTtlMs: z
    .natural()
    .min(60_000)
    .max(86_400_000)
    .default(30 * 60_000)
    .description('how long an open skill window keeps waiting for follow-up work'),
  minSamples: z.natural().min(1).max(100).default(3).description('loads needed before a score stops being provisional'),
  weights: z
    .object({
      static: z.natural().min(0).max(100).default(30).description('authoring quality weight'),
      reliability: z.natural().min(0).max(100).default(25).description('load success and error weight'),
      effectiveness: z.natural().min(0).max(100).default(30).description('user correction weight'),
      efficiency: z.natural().min(0).max(100).default(15).description('cost weight'),
    })
    .description('relative weights; normalised to 100% automatically, set one to 0 to drop a dimension'),
  thresholds: z
    .object({
      excellent: z.natural().min(1).max(100).default(90).description('A grade floor'),
      good: z.natural().min(1).max(100).default(80).description('B grade floor'),
      pass: z.natural().min(1).max(100).default(70).description('C grade floor'),
    })
    .description('grade bands; D stays above 60 and F below it'),
  maxAdvice: z.natural().min(1).max(10).default(3).description('advice items returned per skill in the summary tool'),
  tokenBudgetPerLoad: z
    .natural()
    .min(1000)
    .default(20000)
    .description('billable policy tokens a single skill load may cost before efficiency and advice react'),
  cacheReadWeight: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .description(
      'how much a cached input token counts against the token budget (cache reads are near-free by default)',
    ),
  countTokens: z.boolean().default(true).description('attribute real provider usage to the open skill windows'),
  editBudgetMax: z.natural().min(1).max(10).default(4).description('edits a first-round skill may change at once'),
  editBudgetMin: z.natural().min(1).max(10).default(1).description('edits allowed after the budget has annealed'),
  editBudgetHorizon: z
    .natural()
    .min(1)
    .default(6)
    .description('accepted edits over which the budget anneals to its minimum'),
  noveltyWindow: z
    .natural()
    .min(2)
    .max(10)
    .default(2)
    .description('consecutive same-dimension edits that trigger an exploration directive'),
  pruneMinLoads: z
    .natural()
    .min(1)
    .default(6)
    .description('loads required before a consistently low score becomes a prune recommendation'),
  pruneMaxScore: z
    .natural()
    .min(0)
    .max(100)
    .default(60)
    .description('score below which a well-sampled skill is a prune candidate'),
  registerReviewTool: z
    .boolean()
    .default(true)
    .description('register skill_eval_review (leakage critic + edit ledger)'),
  adviceNoiseFloor: z
    .boolean()
    .default(true)
    .description('only keep a rate-based advice severity when its bootstrap interval clears the threshold'),
  turnReports: z.boolean().default(true).description('write one board per settled turn under reports/turns/'),
  turnReportsKeep: z.natural().min(1).default(50).description('how many per-turn boards to keep'),
  reportOnTurnEnd: z
    .boolean()
    .default(true)
    .description('write reports/latest.md + latest.json after a turn settles (never enters the model context)'),
  reportDir: z.string().description('override the snapshot directory (default: <dataDir>/reports)'),
  ciResamples: z
    .natural()
    .min(0)
    .max(2000)
    .default(200)
    .description('bootstrap resamples for the 95% score interval (0 disables it)'),
  mcpErrorRatePercent: z
    .natural()
    .min(1)
    .max(100)
    .default(20)
    .description('MCP server error-rate percent that raises a critical MCP fix'),
  mcpToolErrorRatePercent: z
    .natural()
    .min(1)
    .max(100)
    .default(30)
    .description('single MCP tool error-rate percent that raises a warning'),
  mcpToolP95Ms: z
    .natural()
    .min(100)
    .default(5000)
    .description('per-tool MCP p95 latency that raises the mcp-tool-slow warning'),
  mcpP95Ms: z.natural().min(100).default(3000).description('MCP p95 latency in ms that raises a slow-server warning'),
  inspectProvider: z
    .boolean()
    .default(true)
    .description('expose the eval data as a Cordis Inspect provider for developer mode'),
  promptHint: z
    .boolean()
    .default(true)
    .description('add the one-line usage hint to the system prompt (the only per-turn token cost, about 60 tokens)'),
  registerTool: z.boolean().default(true).description('register the skill_eval_report tool'),
  registerCommand: z.boolean().default(true).description('register the /skill-eval command'),
  webDashboard: z
    .boolean()
    .default(true)
    .description('serve the HTML dashboard and the JSON route the in-app popup reads'),
  dashboardPath: z
    .string()
    .default('/skill-eval')
    .description('path the dashboard is served on (change it when a reload could not reclaim the old route)'),
})

export type PluginConfig = Partial<ReturnType<typeof Config>>

function statusOf(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { statusCode?: unknown }).statusCode : undefined
}

const REPORT_PARAMETERS = {
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

const REPORT_OUTPUT = {
  schema: { type: 'string', description: 'markdown or JSON report text' },
  render(_args: unknown, value: unknown) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }]
  },
}

/** Run a disposer without letting teardown failures escape into the host. */
function safe(dispose: () => void): () => void {
  return () => {
    try {
      dispose()
    } catch {
      // intentionally ignored: teardown failures must not escape into the host
    }
  }
}

function log(ctx: Host, level: 'info' | 'warn', message: string): void {
  if (DIAGNOSTICS.warnings.length < 50) DIAGNOSTICS.warnings.push(`${level}: ${message}`)
  try {
    const logger = typeof ctx.logger === 'function' ? ctx.logger('skill-eval') : ctx.logger
    logger?.[level]?.(message)
  } catch {
    // logging is best effort
  }
  // `DSH_SKILL_EVAL_DEBUG=1` mirrors diagnostics to stderr, which is where a
  // headless host (and a terminal launch) actually shows them.
  try {
    if (level === 'warn' || process.env.DSH_SKILL_EVAL_DEBUG === '1') {
      console.warn('[skill-eval] ' + message)
    }
  } catch {
    // intentionally ignored: stderr mirror is best effort
  }
}

const VIEWS = ['summary', 'mcp', 'runs', 'standard', 'loop', 'validity', 'history', 'impact', 'dev', 'turns']

/** Read the files the acceptance check needs, best effort. */
async function acceptanceFiles(
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

/** Read `?lang=` from a raw request URL without needing an origin. */
function requestLang(req: Host): string | null {
  const raw = typeof req?.url === 'string' ? req.url : ''
  const index = raw.indexOf('?')
  if (index === -1) return null
  try {
    return new URLSearchParams(raw.slice(index + 1)).get('lang')
  } catch {
    return null
  }
}

function renderAcceptance(acceptance: ReturnType<typeof checkInProcessReport>): string {
  const lines = ['## In-process acceptance', '']
  for (const item of acceptance.results) {
    const mark = item.skipped ? 'SKIP' : item.ok ? 'PASS' : 'FAIL'
    lines.push(`- **${mark}** \`${item.id}\` — ${item.detail}`)
  }
  lines.push('', acceptance.summary)
  return lines.join('\n')
}

interface ReportArgs {
  view?: string
  skill?: unknown
  format?: string
  all?: boolean
}

async function runReport(analyzer: Analyzer, args: ReportArgs, config: PluginConfig): Promise<string> {
  const format = args?.format === 'json' ? 'json' : 'markdown'
  const view = args?.view && VIEWS.includes(args.view) ? args.view : 'summary'
  if (view === 'turns') {
    const reportsDir = config.reportDir ? String(config.reportDir) : path.join(analyzer.store.dir, 'reports')
    const rows = await listTurnReports(reportsDir)
    return format === 'json' ? JSON.stringify({ turns: rows }, null, 2) : renderTurnReportsMarkdown(rows)
  }
  if (view === 'dev') {
    const records = await analyzer.store.readAll()
    const diskVersion = await import('node:fs/promises').then((fs) => fs.readFile(manifestUrl(), 'utf8'))
    let parsedDiskVersion: string | null
    try {
      parsedDiskVersion = JSON.parse(diskVersion).version ?? null
    } catch {
      parsedDiskVersion = null
    }
    const dev = buildDevReport({
      moduleVersion: PLUGIN_VERSION ?? null,
      diskVersion: parsedDiskVersion,
      dataDir: analyzer.store.dir,
      settingsFile: DIAGNOSTICS.settingsFile,
      settings: DIAGNOSTICS.settings,
      settingsErrors: DIAGNOSTICS.settingsErrors,
      config: config,
      routes: DIAGNOSTICS.routes,
      records,
      store: { dir: analyzer.store.dir, failed: analyzer.store.failed, queued: analyzer.store.pending },
      tools: DIAGNOSTICS.tools,
      inspectProvider: DIAGNOSTICS.inspectProvider ? 'skill-eval' : null,
      warnings: DIAGNOSTICS.warnings,
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

/**
 * Resolve one skill inside an agent scope.
 *
 * The catalog is layered: reads only include the user and project layers when
 * the agent is passed as `scope`, so a plain `skills.list()` misses exactly the
 * skills this plugin is measuring. `cwd` widens project-level discovery.
 */
function makeResolveSkill(ctx: Host): ResolveSkill {
  return async (skillName, agent, signal) => {
    const attempts = [
      { scope: agent, signal },
      { scope: agent, signal, cwd: process.cwd() },
    ]
    for (const options of attempts) {
      try {
        const summary = (await ctx.skills.list(options)).find((s: Host) => s.name === skillName)
        if (!summary) continue
        const definition = await ctx.skills.get(skillName, options)
        return { summary, definition }
      } catch {
        // try the next lookup shape
      }
    }
    return null
  }
}

export function apply(ctx: Host, config: PluginConfig): void {
  const cfg: PluginConfig = { ...config }
  if (cfg.enabled === false) return

  // Fill the same defaults the schema would, so the settings API can report
  // effective values even when it is called from a bare config object.
  cfg.weights = { ...DEFAULT_WEIGHTS, ...(cfg.weights ?? {}) }
  cfg.thresholds = { ...DEFAULT_THRESHOLDS, ...(cfg.thresholds ?? {}) }
  // Settings saved from the browser page win over the profile config; they are
  // applied before the analyzer reads the object so a reload and a live edit
  // behave the same way.
  DIAGNOSTICS.routes = []
  DIAGNOSTICS.tools = []
  DIAGNOSTICS.warnings = []
  DIAGNOSTICS.inspectProvider = false
  let settingsDir: string | null = null
  // Diagnostics must show what was actually applied: a hand-edited value that
  // fails validation is dropped from the config, so it must not be reported as
  // saved (nor silently disappear without a warning).
  const refreshSettingsDiagnostics = () => {
    const normalized = normalizeSettings(settingsDir ? loadSettingsSync(settingsDir) : {})
    DIAGNOSTICS.settings = normalized.values
    DIAGNOSTICS.settingsErrors = normalized.errors
    return normalized
  }
  try {
    settingsDir = resolveDataDir(cfg)
    const { values, errors } = refreshSettingsDiagnostics()
    applySettings(cfg, values)
    DIAGNOSTICS.settingsFile = settingsDir ? path.join(settingsDir, SETTINGS_FILE) : null
    if (errors.length > 0)
      log(
        ctx,
        'warn',
        `skill-eval ignored ${errors.length} invalid saved setting(s): ${errors.map((item) => item.key).join(', ')}`,
      )
  } catch (error) {
    log(ctx, 'warn', `skill-eval settings load failed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const analyzer = createAnalyzer(ctx, cfg)
  ctx.effect(
    () => () => {
      try {
        analyzer.dispose()
      } catch {
        // best effort on shutdown
      }
    },
    'skill-eval: analyzer',
  )
  analyzer.store.onError = (message) => {
    DIAGNOSTICS.warnings.push(`store write failed: ${message}`)
    log(ctx, 'warn', `skill-eval store write failed: ${message}`)
  }

  const recorder = createRecorder(ctx, cfg, {
    store: analyzer.store,
    resolveSkill: makeResolveSkill(ctx),
  })

  ctx.effect(
    () => () => {
      try {
        void recorder.dispose()
      } catch {
        // best effort on shutdown
      }
    },
    'skill-eval: recorder',
  )

  // A settled turn writes the aggregated report to disk. This is the "result
  // after every run" surface: it costs zero tokens because it never touches the
  // model context.
  // Always create the snapshotter and read the switches live: reportOnTurnEnd
  // only controls latest.md/json, turnReports controls the per-turn boards, and
  // a settings save must not need a restart (the UI promises immediate apply).
  const snapshots = createSnapshots({
    analyzer,
    dir: cfg.reportDir ? String(cfg.reportDir) : path.join(analyzer.store.dir, 'reports'),
    log: (message) => log(ctx, 'warn', message),
    enabled: () => cfg.reportOnTurnEnd !== false,
    turnReports: () => cfg.turnReports !== false,
    turnReportsKeep: cfg.turnReportsKeep ?? 50,
  })

  if (snapshots) {
    const offTurnStopping = ctx.on('agent/turn-stopping', (payload: Host) => {
      try {
        // Label the board with the turn that actually settled. Without this a
        // concurrent subagent turn (or a new load inside the debounce) would
        // make the writer pick whatever turnLoads is globally newest.
        const sessionId = payload?.agent ? String(payload.agent.id) : null
        const turn = typeof payload?.turn === 'number' ? payload.turn : null
        snapshots.request(sessionId ? { sessionId, turn } : null)
      } catch {
        // intentionally ignored: snapshot request is best effort on turn stop
      }
    })
    ctx.effect(
      () => () => {
        try {
          if (typeof offTurnStopping === 'function') offTurnStopping()
        } catch {
          // best effort
        }
        void snapshots.dispose()
      },
      'skill-eval: snapshots',
    )
  }

  if (cfg.registerTool !== false) {
    ctx.effect(() => {
      const disposers: Array<() => void> = []
      DIAGNOSTICS.tools.push('skill_eval_report')
      disposers.push(
        ctx.tools.register({
          name: 'skill_eval_report',
          description:
            'Report recorded skill execution telemetry with a 0-100 score, an A-F grade and evidence-cited fixes. Use it when the user asks how a skill performed, why it is unreliable, or how to improve a skill. Every fix is backed by a recorded signal (failed loads, post-load tool errors, user corrections, ignored loads, sibling collisions, load latency) or a static authoring check.',
          parameters: REPORT_PARAMETERS,
          output: REPORT_OUTPUT,
          async execute(args: ReportArgs | null | undefined) {
            try {
              return await runReport(analyzer, args ?? {}, cfg)
            } catch (error) {
              return `skill_eval_report failed: ${error instanceof Error ? error.message : String(error)}`
            }
          },
        }),
      )
      return () => {
        for (const dispose of disposers) safe(dispose)()
      }
    }, 'skill-eval: report tool')
  }

  if (cfg.registerReviewTool !== false) {
    ctx.effect(() => {
      DIAGNOSTICS.tools.push('skill_eval_review')
      const dispose = ctx.tools.register({
        name: 'skill_eval_review',
        description:
          'Screen a proposed skill edit for leakage before applying it (benchmark names, hardcoded answers/dates/paths, task-specific logic) and record the hypothesis + verdict in the audit ledger. Use it before rewriting a skill because of eval feedback.',
        parameters: {
          type: 'object',
          properties: {
            skill: { type: 'string', description: 'skill being edited' },
            dimension: {
              type: 'string',
              enum: ['static', 'reliability', 'effectiveness', 'efficiency', 'mcp', 'lifecycle'],
              description: 'which dimension this edit targets (drives the exploration directive)',
            },
            hypothesis: { type: 'string', description: 'what should improve and how it will be measured' },
            diff: { type: 'string', description: 'the proposed change, as a diff or the new body text' },
          },
          required: ['skill'],
          additionalProperties: false,
        },
        output: {
          schema: { type: 'string', description: 'verdict and reasons' },
          render(_args: unknown, value: unknown) {
            return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
          },
        },
        async execute(args: Json) {
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
        },
      })
      return () => safe(dispose)
    }, 'skill-eval: review tool')
  }

  if (cfg.registerCommand !== false) {
    ctx.inject(['commands'], (c: Host) => {
      c.effect(() => {
        const dispose = c.commands.register({
          name: 'skill-eval',
          description: 'show the skill execution report (scores, grades and cited fixes)',
          input: { hint: '[skill-name]' },
          async handler(invocation: Host) {
            const target = String(invocation.rawInput ?? '').trim()
            try {
              const keyword = target.toLowerCase()
              if (keyword === 'accept' || keyword === 'doctor') {
                const report = await analyzer.build()
                const files = await acceptanceFiles(
                  analyzer.store,
                  (file: string) => import('node:fs/promises').then((fs) => fs.readFile(file, 'utf8')),
                  cfg.reportDir ? String(cfg.reportDir) : path.join(analyzer.store.dir, 'reports'),
                )
                const acceptance = checkInProcessReport(report, { version: PLUGIN_VERSION ?? 'unknown', files })
                return { kind: 'success', text: '\n' + renderAcceptance(acceptance) + '\n' }
              }
              if (keyword.startsWith('history ') || keyword.startsWith('impact ')) {
                const view = keyword.split(' ')[0]
                const skill = target.slice(view.length + 1).trim()
                const text = await runReport(analyzer, { view, skill }, cfg)
                return { kind: 'success', text: `\n${text}\n` }
              }
              if (keyword === 'config') {
                const lines = [
                  '## 配置 / effective settings',
                  '',
                  `override file: \`${path.join(settingsDir ?? '<unknown>', SETTINGS_FILE)}\``,
                  '',
                ]
                for (const field of SETTINGS_KEYS) {
                  const value = field
                    .split('.')
                    .reduce<unknown>((target, key) => (target == null ? undefined : (target as Json)[key]), cfg)
                  lines.push(`- \`${field}\`: **${value === undefined ? '—' : String(value)}**`)
                }
                lines.push('', '浏览器里打开 `<dashboardPath>/config` 可直接修改（保存后立即生效）。')
                return { kind: 'success', text: `\n${lines.join('\n')}\n` }
              }
              if (keyword === 'turns' || keyword === 'boards') {
                const text = await runReport(analyzer, { view: 'turns' }, cfg)
                return { kind: 'success', text: `\n${text}\n` }
              }
              if (keyword === 'dev' || keyword === 'diagnostics') {
                const text = await runReport(analyzer, { view: 'dev' }, cfg)
                return { kind: 'success', text: `\n${text}\n` }
              }
              if (keyword === 'validity' || keyword === 'valid') {
                const text = await runReport(analyzer, { view: 'validity' }, cfg)
                return { kind: 'success', text: `\n${text}\n` }
              }
              if (keyword === 'loop' || keyword.startsWith('loop ')) {
                const rest = keyword.startsWith('loop ') ? target.slice(5).trim() : ''
                if (rest === 'all') {
                  const text = await runReport(analyzer, { view: 'loop', all: true }, cfg)
                  return { kind: 'success', text: `\n${text}\n` }
                }
                const text = await runReport(analyzer, { view: 'loop', skill: rest || undefined }, cfg)
                return { kind: 'success', text: `\n${text}\n` }
              }
              const view = ['mcp', 'runs', 'standard'].includes(keyword) ? keyword : undefined
              const text = await runReport(analyzer, view ? { view } : { skill: target || undefined }, cfg)
              return { kind: 'success', text: `\n${text}\n` }
            } catch (error) {
              return {
                kind: 'error',
                text: `skill-eval failed: ${error instanceof Error ? error.message : String(error)}`,
              }
            }
          },
        })
        return () => safe(dispose)
      }, 'skill-eval: command')
    })
  }

  if (cfg.webDashboard !== false) {
    const base = String(cfg.dashboardPath || '/skill-eval').replace(/\/$/, '')
    // The client bundle ships a fixed route contract: data/settings stay under
    // /skill-eval even when the *pages* move, otherwise a custom dashboardPath
    // silently breaks the panel and the native config form.
    const clientBase = '/skill-eval'
    const dataPath = `${clientBase}/data`

    // Writes are same-origin fenced. Comparing Origin to Host alone does not
    // stop DNS rebinding (both are the attacker's domain after rebinding), so
    // the Host itself must be the server's own origin or a loopback name.
    let serverOrigin: string | null = null
    const hostnameOf = (value: unknown) => {
      try {
        return new URL(String(value).includes('://') ? String(value) : 'http://' + String(value)).hostname.toLowerCase()
      } catch {
        return ''
      }
    }
    const allowedWriteHosts = () => {
      const hosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
      const own = serverOrigin ? hostnameOf(serverOrigin) : ''
      if (own) hosts.add(own)
      return hosts
    }
    const rememberOrigin = (webServer: Host) => {
      try {
        const value = webServer.getOrigin()
        if (typeof value === 'string' && value) serverOrigin = value
      } catch {
        // keep the loopback fallback
      }
    }
    ctx.inject(['webServer'], (c: Host) => {
      c.effect(() => {
        rememberOrigin(c.webServer)
        return () => {}
      }, 'skill-eval: origin')
    })

    // The board's dev tab shows what the agent's `view:"dev"` report shows in
    // short form: which generation is loaded, whether the package on disk moved
    // ahead of it (the ESM-cache restart trap), how many routes this generation
    // claimed, and whether the event store is healthy.
    const diagnosticsPayload = () => {
      const diskVersion = packageVersion()
      return {
        moduleVersion: PLUGIN_VERSION ?? null,
        diskVersion,
        skew: Boolean(PLUGIN_VERSION && diskVersion && PLUGIN_VERSION !== diskVersion),
        routes: DIAGNOSTICS.routes.length,
        tools: DIAGNOSTICS.tools.length,
        inspectProvider: Boolean(DIAGNOSTICS.inspectProvider),
        settingsFile: DIAGNOSTICS.settingsFile ?? null,
        warnings: DIAGNOSTICS.warnings.length,
      }
    }

    const writeReport = async (res: Host) => {
      const report = await analyzer.build()
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      // The pages may live under a custom dashboardPath; ship their exact
      // paths so the client never hardcodes a route the host did not register.
      const pages = PLUGIN_VERSION
        ? { board: `${base}/board/${PLUGIN_VERSION}`, config: `${base}/board/${PLUGIN_VERSION}/config` }
        : { board: base, config: `${base}/config` }
      res.end(JSON.stringify({ ...report, dev: diagnosticsPayload(), pages }, null, 2))
    }

    const bodyTooLarge = () => Object.assign(new Error('request body too large'), { statusCode: 413 })
    const readBody = (req: Host, limit = 64 * 1024) =>
      new Promise<string>((resolve, reject) => {
        const declared = Number(req.headers?.['content-length'])
        if (Number.isFinite(declared) && declared > limit) {
          reject(bodyTooLarge())
          return
        }
        let body = ''
        let size = 0
        let settled = false
        const fail = (error: unknown) => {
          if (settled) return
          settled = true
          reject(error)
          if (typeof req.resume === 'function') req.resume()
        }
        if (typeof req.setEncoding === 'function') req.setEncoding('utf8')
        req.on('data', (chunk: string) => {
          if (settled) return
          size += Buffer.byteLength(chunk)
          if (size > limit) {
            fail(bodyTooLarge())
            return
          }
          body += chunk
        })
        req.on('end', () => {
          if (settled) return
          settled = true
          resolve(body)
        })
        req.on('error', (error: unknown) => fail(error))
      })

    // Plugin routes bypass the host's own trust fence, so settings writes get a
    // minimal same-origin gate here: reject cross-site fetch metadata, reject a
    // mismatched Origin, and require a custom header on the JSON API (which a
    // cross-site simple request cannot send without a preflight it would fail).
    const trustedWrite = (req: Host, { requireHeader = false }: { requireHeader?: boolean } = {}) => {
      const site = String(req.headers?.['sec-fetch-site'] ?? '').toLowerCase()
      if (site === 'cross-site') return false
      const host = String(req.headers?.['host'] ?? '')
      if (!allowedWriteHosts().has(hostnameOf(host))) return false
      const origin = req.headers?.origin
      if (origin) {
        try {
          const parsed = new URL(origin)
          if (parsed.host !== host) return false
        } catch {
          return false
        }
      }
      if (requireHeader && req.headers?.['x-skill-eval-config'] !== '1') return false
      return true
    }

    const servePageAt = (pageBase: string) => async (req: Host, res: Host) => {
      try {
        const report = await analyzer.build()
        const lang = resolveLang(req.headers?.['accept-language'], requestLang(req))
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(renderHtml(report, { base: pageBase, lang }))
      } catch (error) {
        log(ctx, 'warn', `dashboard failed: ${error instanceof Error ? error.message : String(error)}`)
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('skill-eval dashboard failed')
      }
    }

    const handleConfig = async (req: Host, res: Host, url: URL, pageBase = base) => {
      const lang = resolveLang(req.headers?.['accept-language'], url.searchParams.get('lang'))
      const send = (status: number, html: string) => {
        res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(html)
      }
      try {
        if (req.method === 'POST') {
          if (!trustedWrite(req)) {
            send(403, 'cross-site settings write rejected')
            return
          }
          const body = await readBody(req)
          const submitted = parseFormSettings(body)
          const { values, errors } = normalizeSettings(submitted)
          const weightError = effectiveWeightError(values)
          if (weightError) errors.push(weightError)
          if (errors.length > 0) {
            send(400, renderConfigHtml({ config: cfg, base: pageBase, errors, lang }))
            return
          }
          if (settingsDir) await updateSettings(settingsDir, values)
          applySettings(cfg, values)
          analyzer.invalidate()
          refreshSettingsDiagnostics()
          send(200, renderConfigHtml({ config: cfg, base: pageBase, saved: true, lang }))
          return
        }
        send(
          200,
          renderConfigHtml({
            config: cfg,
            base: pageBase,
            saved: url.searchParams.get('saved') === '1',
            errors: [],
            lang,
          }),
        )
      } catch (error) {
        const status = statusOf(error) === 413 ? 413 : 500
        send(status, status === 413 ? 'request body too large' : 'config failed')
      }
    }

    // The JSON API is its own exact route so the popup keeps working even when
    // the page route below cannot be reclaimed after a reload (the host keeps
    // routes registered by a previous instance). The versioned alias is new on
    // every release, so even a hot reload that cannot reclaim `dataPath` gets a
    // working URL for the current generation.
    const effectiveWeightError = (values: Record<string, unknown>) => {
      const weights: Record<string, unknown> = { ...(cfg.weights ?? {}) }
      for (const [key, value] of Object.entries(values ?? {})) {
        if (key.startsWith('weights.')) weights[key.slice('weights.'.length)] = value
      }
      const sum = ['static', 'reliability', 'effectiveness', 'efficiency'].reduce(
        (total, dimension) => total + (Number(weights[dimension]) || 0),
        0,
      )
      return sum > 0 ? null : { key: 'weights.total', message: 'weights sum must be positive' }
    }
    const settingsValue = (key: string) => {
      const [head, leaf] = key.split('.')
      const top = (cfg as Json)?.[head]
      const raw = leaf ? top?.[leaf] : top
      return raw === undefined ? null : raw
    }
    const settingsPayload = () => ({
      fields: SETTINGS_FIELDS.map((field) => ({
        ...field,
        labelZh: FIELD_ZH[field.key] ?? field.label,
        value: settingsValue(field.key),
      })),
      values: Object.fromEntries(SETTINGS_FIELDS.map((field) => [field.key, settingsValue(field.key)])),
      version: PLUGIN_VERSION ?? null,
    })
    const readJsonBody = async (req: Host) => {
      const raw = await readBody(req)
      if (!raw) return {}
      try {
        return JSON.parse(raw)
      } catch {
        return Object.fromEntries(new URLSearchParams(raw))
      }
    }
    const handleSettingsApi = async (req: Host, res: Host) => {
      const send = (status: number, payload: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end(JSON.stringify(payload, null, 2))
      }
      try {
        if (req.method === 'POST') {
          if (!trustedWrite(req, { requireHeader: true })) {
            send(403, { saved: false, errors: [{ key: 'origin', message: 'cross-site settings write rejected' }] })
            return
          }
          const body = await readJsonBody(req)
          const { values, errors } = normalizeSettings(body)
          const weightError = effectiveWeightError(values)
          if (weightError) errors.push(weightError)
          if (errors.length > 0) {
            send(400, { saved: false, errors, values: settingsPayload().values })
            return
          }
          if (settingsDir) await updateSettings(settingsDir, values)
          applySettings(cfg, values)
          analyzer.invalidate()
          refreshSettingsDiagnostics()
          send(200, { saved: true, errors: [], values: settingsPayload().values })
          return
        }
        send(200, settingsPayload())
      } catch (error) {
        const status = statusOf(error) === 413 ? 413 : 500
        send(status, {
          saved: false,
          errors: [{ key: 'server', message: status === 413 ? 'request body too large' : 'settings failed' }],
        })
      }
    }

    const dataPaths = PLUGIN_VERSION ? [`${dataPath}/${PLUGIN_VERSION}`, dataPath] : [dataPath]

    // Settings API: the native plugin-config page renders this instead of the
    // standalone HTML form. Versioned alias for the same hot-reload reason.
    const settingsPaths = PLUGIN_VERSION
      ? [`${clientBase}/settings/${PLUGIN_VERSION}`, `${clientBase}/settings`]
      : [`${clientBase}/settings`]
    for (const routePath of settingsPaths)
      ctx.inject(['webServer'], (c: Host) => {
        c.effect(() => {
          let dispose: () => void
          try {
            dispose = c.webServer.register({ kind: 'exact', path: routePath, handler: handleSettingsApi })
            DIAGNOSTICS.routes.push(routePath)
          } catch (error) {
            log(
              ctx,
              'warn',
              `settings route ${routePath} not registered: ${error instanceof Error ? error.message : String(error)}`,
            )
            return () => {}
          }
          return () => safe(dispose)
        }, 'skill-eval: settings route')
      })
    for (const routePath of dataPaths)
      ctx.inject(['webServer'], (c: Host) => {
        c.effect(() => {
          let dispose: () => void
          try {
            dispose = c.webServer.register({
              kind: 'exact',
              path: routePath,
              async handler(req: Host, res: Host) {
                try {
                  await writeReport(res)
                } catch (error) {
                  log(ctx, 'warn', `data failed: ${error instanceof Error ? error.message : String(error)}`)
                  res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
                  res.end('skill-eval data failed')
                }
              },
            })
            DIAGNOSTICS.routes.push(routePath)
          } catch (error) {
            log(
              ctx,
              'warn',
              `data route ${routePath} not registered: ${error instanceof Error ? error.message : String(error)}`,
            )
            return () => {}
          }
          return () => safe(dispose)
        }, 'skill-eval: data route')
      })

    // Exact routes are matched before any prefix route, so registering the page
    // and the settings page exactly keeps them working even when a previous
    // generation still owns the `${base}` prefix (routes cannot be reclaimed).
    // Exact page routes cannot be reclaimed once an older generation owns them
    // (hot reload replaces the plugin but the host keeps the old route). The
    // versioned alias is therefore the reliable URL for the current generation,
    // and the canonical paths stay as best-effort for a clean start.
    const boardVersion = PLUGIN_VERSION || null
    const versionedBase = boardVersion ? `${base}/board/${boardVersion}` : null
    const configAt = (pageBase: string) => async (req: Host, res: Host) => {
      const origin = `http://${req.headers?.host ?? 'localhost'}`
      await handleConfig(req, res, new URL(req.url ?? `${pageBase}/config`, origin), pageBase)
    }
    // Each route renders links/actions against its OWN base: the versioned page
    // must post to the versioned config route, otherwise a hot reload sends the
    // save back to a route the previous generation still owns.
    const pageRoutes = [
      { path: base, handler: servePageAt(base) },
      { path: `${base}/config`, handler: configAt(base) },
      ...(versionedBase
        ? [
            { path: versionedBase, handler: servePageAt(versionedBase) },
            { path: `${versionedBase}/config`, handler: configAt(versionedBase) },
          ]
        : []),
    ]
    for (const pageRoute of pageRoutes)
      ctx.inject(['webServer'], (c: Host) => {
        c.effect(() => {
          let dispose: () => void
          try {
            dispose = c.webServer.register({ kind: 'exact', path: pageRoute.path, handler: pageRoute.handler })
            DIAGNOSTICS.routes.push(pageRoute.path)
          } catch (error) {
            log(
              ctx,
              'warn',
              `page route ${pageRoute.path} not registered: ${error instanceof Error ? error.message : String(error)}`,
            )
            return () => {}
          }
          return () => safe(dispose)
        }, 'skill-eval: page route')
      })

    ctx.inject(['webServer'], (c: Host) => {
      c.effect(() => {
        let dispose: () => void
        try {
          dispose = c.webServer.register({
            kind: 'prefix',
            path: base,
            async handler(req: Host, res: Host) {
              let origin = 'http://localhost'
              try {
                origin = c.webServer.getOrigin()
              } catch {
                // keep the fallback origin
              }
              const url = new URL(req.url ?? base, origin)
              try {
                if (url.pathname.replace(/\/$/, '').endsWith('/data')) {
                  await writeReport(res)
                  return
                }
                if (url.pathname.replace(/\/$/, '').endsWith('/config')) {
                  await handleConfig(req, res, url)
                  return
                }
                const report = await analyzer.build()
                const lang = resolveLang(req.headers?.['accept-language'], url.searchParams.get('lang'))
                res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
                res.end(renderHtml(report, { base, lang }))
              } catch (error) {
                log(ctx, 'warn', `dashboard failed: ${error instanceof Error ? error.message : String(error)}`)
                res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
                res.end('skill-eval dashboard failed')
              }
            },
          })
          DIAGNOSTICS.routes.push(base)
        } catch (error) {
          log(
            ctx,
            'warn',
            `dashboard route ${base} not registered: ${error instanceof Error ? error.message : String(error)}`,
          )
          return () => {}
        }
        return () => safe(dispose)
      }, 'skill-eval: dashboard')
    })
  }

  // Developer-mode surface: the eval data registers next to the harness's own
  // Service/Event/Config providers, so `cordis_inspect_query` can read it.
  if (cfg.inspectProvider !== false) {
    ctx.inject(['cordisInspect'], (c: Host) => {
      c.effect(() => {
        try {
          const dispose = c.cordisInspect.register(createInspectProvider(analyzer))
          DIAGNOSTICS.inspectProvider = true
          log(ctx, 'info', 'inspect provider "skill-eval" registered')
          return dispose
        } catch (error) {
          log(ctx, 'warn', `inspect provider not registered: ${error instanceof Error ? error.message : String(error)}`)
          return () => {}
        }
      }, 'skill-eval: inspect provider')
    })
  }

  const SETTINGS_KEYS = SETTINGS_FIELDS.map((field) => field.key)

  ctx.inject(['systemPrompt'], (c: Host) => {
    c.effect(() => {
      const stop = c.systemPrompt.section({
        name: 'skill-eval:usage',
        order: 118,
        text: () =>
          cfg.promptHint === false
            ? ''
            : 'Skill telemetry is recorded for every `skill` load. When asked how a skill performed or how to improve it, call `skill_eval_report` (pass {"skill":"<name>"} for one skill) and act on the cited fixes instead of guessing. Before editing a skill named in the report, screen the change with `skill_eval_review` (leakage critic) and record the hypothesis; ask `skill_eval_report` with view:"loop" for the next step and view:"validity" for what the evidence can and cannot support.',
      })
      return () => safe(stop)
    }, 'skill-eval: prompt section')
  })

  log(ctx, 'info', `skill-eval: recording enabled, data dir ${analyzer.store.dir}`)
}
