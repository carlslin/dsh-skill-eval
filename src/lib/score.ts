/**
 * Pure scoring core for dsh-skill-eval.
 *
 * The only import is the deterministic RNG helper: this module must stay
 * unit-testable and safe to load inside the host process without touching any
 * DSH API.
 *
 * The weighting model borrows the *idea* from the public skill-eval tooling
 * (aws-samples/sample-agent-skill-eval: 40/40/20 audit|functional|trigger with an
 * A-F grade band; NVIDIA/SkillEvaluator: multi-dimensional rubric + 70 threshold).
 * Nothing is copied: every signal below is derived from live DSH runtime
 * telemetry that those static-first tools cannot observe.
 */
import { mulberry32 } from './random.ts'
import type { Interval, Sample, Thresholds, WindowRecord, Weights } from './types.ts'

export const DEFAULT_WEIGHTS = Object.freeze({
  static: 0.3,
  reliability: 0.25,
  effectiveness: 0.3,
  efficiency: 0.15,
})

export const DEFAULT_THRESHOLDS = Object.freeze({
  pass: 70,
  good: 80,
  excellent: 90,
})

export function gradeOf(score: unknown, thresholds: Partial<Thresholds> = DEFAULT_THRESHOLDS): string {
  if (score === null || score === undefined || score === '') return '?'
  const s = Number(score)
  if (!Number.isFinite(s)) return '?'
  const bands: Array<[number, string]> = [
    [thresholds.excellent ?? 90, 'A'],
    [thresholds.good ?? 80, 'B'],
    [thresholds.pass ?? 70, 'C'],
    [60, 'D'],
    [0, 'F'],
  ]
  for (const [min, grade] of bands) if (s >= min) return grade
  return 'F'
}

/**
 * Dissatisfaction markers only. Weak words like 重新/再试/again/actually are
 * excluded on purpose: "重新排序这些页面" is a legitimate request, and a false
 * positive would punish a healthy skill.
 */
const CORRECTION_PATTERNS = [
  /不对/,
  /不是这个/,
  /不是我要/,
  /错了/,
  /搞错/,
  /重做/,
  /再来一次/,
  /别用/,
  /不要用/,
  /还是不行/,
  /还是不对/,
  /没生效/,
  /不好用/,
  /有问题/,
  /\bwrong\b/i,
  /\bnope\b/i,
  /that'?s not (what|right|correct)/i,
  /\bredo\b/i,
  /\bstart over\b/i,
  /\bstill (broken|failing|wrong|not working)\b/i,
  /\b(try|do it) again\b/i,
  /\b(doesn'?t|didn'?t|won'?t) work/i,
  /\bnot working\b/i,
]

/**
 * Does a user message read as a correction/rejection of what just happened?
 * Deliberately conservative: false positives punish a skill for normal follow-ups.
 */
export function isCorrection(text: unknown): boolean {
  if (typeof text !== 'string' || text.length === 0) return false
  const t = text.trim().slice(0, 400)
  if (t.length === 0) return false
  return CORRECTION_PATTERNS.some((re) => re.test(t))
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function round(n: number, digits = 1): number | null {
  if (!Number.isFinite(n)) return null
  const f = 10 ** digits
  return Math.round(n * f) / f
}

export function median(nums: unknown[]): number | null {
  const xs = nums.filter((n): n is number => Number.isFinite(n)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

// ---------------------------------------------------------------------------
// Static (authoring) quality — the "audit" dimension.
// ---------------------------------------------------------------------------

interface StaticView {
  name?: string
  description: string
  /** Whitespace-normalized, catalog-capped description the model actually sees. */
  catalogDescription: string
  catalogTruncated: boolean
  catalogComplete: boolean
  modelInvocable: boolean
  whenToUse: string
  content: string
  bodyLines: number
  sectionCount: number
  integrity: Integrity | null
}

export interface Integrity {
  checked: number
  missing?: string[]
  ok?: boolean
}

export interface SkillSummary {
  name?: string
  description?: string
  whenToUse?: string
  source?: string | null
  provider?: string | null
  path?: string | null
  resourceBase?: { kind?: string; path?: string } | string | null
  invocation?: { modelInvocable?: boolean; userInvocable?: boolean } | null
}

const STATIC_CHECKS: Array<{ id: string; weight: number; label: string; evaluate: (s: StaticView) => number | null }> =
  [
    {
      id: 'desc-length',
      weight: 12,
      label: 'description length (as rendered in the catalog)',
      evaluate: (s) => {
        const n = (s.catalogDescription ?? '').length
        if (n >= 60) return 1
        if (n >= 30) return 0.5
        return 0
      },
    },
    {
      id: 'desc-trigger',
      weight: 12,
      label: 'description states when to use it (as rendered)',
      // A user-only skill never enters the model catalog; trigger language in
      // its description cannot route the model, so the check is not scored.
      evaluate: (s) =>
        s.modelInvocable
          ? /use when|when to use|triggers?|适用|适用于|当用户|用于|使用场景/i.test(s.catalogDescription ?? '')
            ? 1
            : 0
          : null,
    },
    {
      id: 'catalog-truncated',
      weight: 6,
      label: 'description fits the model catalog cap',
      evaluate: (s) => (s.catalogTruncated ? 0 : 1),
    },
    {
      id: 'body-present',
      weight: 10,
      label: 'body is substantive',
      evaluate: (s) => {
        const n = s.bodyLines ?? 0
        if (n >= 15) return 1
        if (n >= 5) return 0.5
        return 0
      },
    },
    {
      id: 'body-compact',
      weight: 18,
      label: 'body stays under the 500-line guidance',
      evaluate: (s) => {
        const n = s.bodyLines ?? 0
        if (n === 0) return 0
        if (n <= 500) return 1
        return clamp(1 - (n - 500) / 1000, 0, 1)
      },
    },
    {
      id: 'sections',
      weight: 10,
      label: 'body is sectioned',
      evaluate: (s) => {
        const n = s.sectionCount ?? 0
        if (n >= 2) return 1
        if (n === 1) return 0.5
        return 0
      },
    },
    {
      id: 'progressive-disclosure',
      weight: 15,
      label: 'delegates detail to references/ or scripts/',
      evaluate: (s) =>
        /references\/|scripts\/|assets\/|##\s*(Reference|References|参考|参考资料)/i.test(s.content ?? '') ? 1 : 0,
    },
    {
      id: 'no-placeholder',
      weight: 10,
      label: 'no TODO/TBD placeholders',
      evaluate: (s) => (/\b(TODO|TBD|FIXME|XXX)\b/.test(s.content ?? '') ? 0 : 1),
    },
    {
      id: 'has-example',
      weight: 5,
      label: 'contains a usage example',
      evaluate: (s) => (((s.content ?? '').match(/```/g)?.length ?? 0) >= 2 ? 1 : 0),
    },
    {
      id: 'anti-trigger',
      weight: 5,
      label: 'states when NOT to use it',
      evaluate: (s) =>
        /do not use|don'?t use|not for|never use|不(?:要|应|适用)用于|不用于|避免(?:用于|使用)|不要用在/i.test(
          `${s.description ?? ''}\n${s.whenToUse ?? ''}\n${s.content ?? ''}`,
        )
          ? 1
          : 0,
    },
    {
      id: 'skill-name',
      weight: 4,
      label: 'skill id is a kebab-case name',
      evaluate: (s) => (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s.name ?? '') ? 1 : 0),
    },
    {
      id: 'reference-integrity',
      weight: 8,
      label: 'every referenced file exists',
      // null = cannot be checked here (no filesystem view); the check is then
      // excluded from the static score instead of pretending to pass or fail.
      evaluate: (s) => {
        const integrity = s.integrity
        if (!integrity || typeof integrity.checked !== 'number') return null
        if (integrity.checked === 0) return null
        const missing = integrity.missing?.length ?? 0
        return (integrity.checked - missing) / integrity.checked
      },
    },
  ]

/**
 * Build the static profile from a skill summary + loaded definition.
 * Returns null when the skill cannot be resolved at all (deleted provider etc.).
 */
export function staticProfile(
  summary: SkillSummary | null | undefined,
  definition: { content?: unknown; path?: string | null } | null | undefined,
  options: {
    integrity?: Integrity | null
    /** Exact description from the durable session catalog, when captured. */
    catalogDescription?: string
    /** Whether the catalog discovery completed (ctx.skills.snapshot().complete). */
    catalogComplete?: boolean
  } = {},
) {
  if (!summary) return null
  const content = typeof definition?.content === 'string' ? definition.content : ''
  const bodyLines = content.length === 0 ? 0 : content.split('\n').length
  const sectionCount = (content.match(/^##\s+\S/gm) ?? []).length
  const rawDescription = (summary.description ?? '').replace(/\s+/g, ' ').trim()
  // DSH renders only name + description, whitespace-normalized and cut to the
  // catalog cap (500 by default) with a trailing ellipsis. Without a captured
  // catalog we reconstruct that shape so authoring checks cannot reward text
  // the model never sees.
  const reconstructed = rawDescription.length <= 500 ? rawDescription : `${rawDescription.slice(0, 497)}...`
  const catalogDescription = typeof options.catalogDescription === 'string' ? options.catalogDescription : reconstructed
  const catalogTruncated =
    typeof options.catalogDescription === 'string'
      ? options.catalogDescription.length < rawDescription.length
      : rawDescription.length > 500
  const invocation = summary.invocation
  const modelInvocable = !invocation || invocation.modelInvocable !== false
  const view = {
    name: summary.name,
    description: summary.description ?? '',
    catalogDescription,
    catalogTruncated,
    catalogComplete: options.catalogComplete !== false,
    modelInvocable,
    whenToUse: summary.whenToUse ?? '',
    content,
    bodyLines,
    sectionCount,
    source: summary.source ?? null,
    provider: summary.provider ?? null,
    path: summary.path ?? definition?.path ?? null,
    resolved: content.length > 0,
    integrity: options.integrity ?? null,
  }
  const raw = STATIC_CHECKS.map((c) => {
    const evaluated = c.evaluate(view)
    if (evaluated === null || evaluated === undefined) {
      return { id: c.id, label: c.label, weight: c.weight, fraction: null, points: 0 as number | null, skipped: true }
    }
    const fraction = clamp(Number(evaluated) || 0, 0, 1)
    return { id: c.id, label: c.label, weight: c.weight, fraction, points: round(c.weight * fraction, 1) }
  })
  const checks = raw
  const counted = checks.filter((c): c is Extract<(typeof checks)[number], { fraction: number }> => !('skipped' in c))
  const earned = counted.reduce((a, c) => a + c.weight * c.fraction, 0)
  const totalWeight = counted.reduce((a, c) => a + c.weight, 0)
  // All checks skipped (e.g. future rule set) — explicit null instead of 0/0.
  const score = totalWeight > 0 ? round((earned / totalWeight) * 100, 1) : null
  // The full body is only needed while the checks run; persisting it would
  // duplicate every SKILL.md into the append-only store and every report JSON.
  const { content: _body, ...persisted } = view
  return {
    ...persisted,
    checks,
    score,
    failedChecks: counted.filter((c) => c.fraction < 1),
  }
}

// ---------------------------------------------------------------------------
// Runtime aggregation over invocation samples.
// ---------------------------------------------------------------------------

/**
 * Aggregate closed+open invocation samples for one skill.
 *
 * sample = {
 *   ok: boolean,            // did the `skill` tool call succeed
 *   loadMs?: number,        // duration of the load call
 *   error?: string,         // load error message
 *   window?: {              // the observation window after a successful load
 *     toolCalls: number,
 *     errors: number,
 *     errorNames: string[],
 *     corrections: string[],
 *     otherSkills: string[],
 *     turnEnded: boolean,
 *     truncated: boolean,
 *   } | null
 * }
 */
export function aggregate(samples: unknown, options: { cacheReadWeight?: number } = {}) {
  const safe: Sample[] = Array.isArray(samples) ? samples.filter(Boolean) : []
  const loads = safe.length
  const loadOk = safe.filter((s) => s.ok).length
  const closed = safe.filter((s) => s.window)
  const windows = closed.map((s) => s.window as WindowRecord)

  const count = (value: unknown) => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? n : 0
  }
  const toolCalls = windows.reduce((a, w) => a + count(w.toolCalls), 0)
  const errors = windows.reduce((a, w) => a + count(w.errors), 0)
  const withCorrection = windows.filter((w) => (Array.isArray(w.corrections) ? w.corrections.length : 0) > 0).length
  const withSibling = windows.filter((w) => (Array.isArray(w.otherSkills) ? w.otherSkills.length : 0) > 0).length
  // A subagent that loads a skill and finishes immediately is not the same
  // failure as a root session dropping a skill: judge abandonment on root runs.
  const rootWindows = windows.filter((w) => w.origin !== 'subagent')
  // A window force-closed for memory reasons is censored, not abandoned: it
  // must not turn "we ran out of tracked sessions" into an effectiveness claim.
  const abandonBase = (rootWindows.length > 0 ? rootWindows : windows).filter((w) => w.closeReason !== 'evicted')
  // A window that produced a deliverable, a workspace change, a settled job or
  // a completed task is not "abandoned" just because it used no tool calls.
  const abandonedRoot = abandonBase.filter((w) => {
    if (count(w.toolCalls) > 0) return false
    const o = w.outcomes
    if (!o) return true
    const produced =
      (Number(o.deliverables) || 0) +
      (Number(o.workspaceChanges) || 0) +
      (Number(o.jobsSettled) || 0) +
      (Number(o.tasksCompleted) || 0) +
      (Number(o.workflowRuns) || 0)
    return produced === 0
  }).length

  const withLoopError = windows.filter((w) => count(w.loopErrors) > 0).length
  const loopErrors = windows.reduce((a, w) => a + count(w.loopErrors), 0)
  const llmRetries = windows.reduce((a, w) => a + count(w.llmRetries), 0)
  const loopErrorNames: Record<string, number> = Object.create(null)
  for (const w of windows) {
    if (typeof w.lastLoopError === 'string' && w.lastLoopError) {
      loopErrorNames[w.lastLoopError] = (loopErrorNames[w.lastLoopError] ?? 0) + 1
    }
  }

  // MCP health is independent of which skill was loaded: merge every window's
  // per-server bucket so the report can show a board per MCP server.
  const mcp: Record<
    string,
    {
      calls: number
      errors: number
      ms: number
      windows: number
      samples: number[]
      tools: Record<string, { calls: number; errors: number; ms: number; samples: number[] }>
    }
  > = Object.create(null)
  for (const w of windows) {
    for (const [server, bucket] of Object.entries(w.mcp ?? {})) {
      if (!bucket || typeof bucket !== 'object') continue
      if (!Object.hasOwn(mcp, server)) {
        mcp[server] = { calls: 0, errors: 0, ms: 0, windows: 0, samples: [], tools: Object.create(null) }
      }
      const entry = mcp[server]
      entry.calls += count(bucket.calls)
      entry.errors += count(bucket.errors)
      entry.ms += count(bucket.ms)
      entry.windows += 1
      if (Array.isArray(bucket.samples)) {
        for (const sample of bucket.samples) {
          if (typeof sample === 'number' && entry.samples.length < 400) entry.samples.push(sample)
        }
      }
      for (const [tool, stats] of Object.entries(bucket.tools ?? {})) {
        if (!stats || typeof stats !== 'object' || Array.isArray(stats)) continue
        const t = Object.hasOwn(entry.tools, tool) ? entry.tools[tool] : { calls: 0, errors: 0, ms: 0, samples: [] }
        t.calls += count(stats.calls)
        t.errors += count(stats.errors)
        t.ms = (t.ms ?? 0) + count(stats.ms)
        if (Array.isArray(stats.samples)) {
          for (const sample of stats.samples) {
            if (typeof sample === 'number' && t.samples.length < 60) t.samples.push(sample)
          }
        }
        entry.tools[tool] = t
      }
      mcp[server] = entry
    }
  }

  const corrections = windows.flatMap((w) =>
    Array.isArray(w.corrections) ? w.corrections.filter((c) => typeof c === 'string') : [],
  )
  const siblings: Record<string, number> = Object.create(null)
  for (const w of windows) {
    for (const s of Array.isArray(w.otherSkills) ? w.otherSkills : []) {
      if (typeof s === 'string' && s) siblings[s] = (siblings[s] ?? 0) + 1
    }
  }
  const errorNames: Record<string, number> = Object.create(null)
  for (const w of windows) {
    for (const e of Array.isArray(w.errorNames) ? w.errorNames : []) {
      if (typeof e === 'string' && e) errorNames[e] = (errorNames[e] ?? 0) + 1
    }
  }

  const tokens = { input: 0, output: 0, cacheRead: 0, calls: 0 }
  for (const w of windows) {
    const t = w.tokens
    if (!t || typeof t !== 'object') continue
    tokens.input += Number(t.input) || 0
    tokens.output += Number(t.output) || 0
    tokens.cacheRead += Number(t.cacheRead) || 0
    tokens.calls += Number(t.calls) || 0
  }
  const cacheWeight = finiteOr(options.cacheReadWeight, 0)
  const billable = tokens.input + tokens.output + tokens.cacheRead * cacheWeight
  // Only windows that actually carried model usage count: older windows were
  // recorded before token capture existed and would dilute the per-load cost.
  const tokenWindows = windows.filter((w) => w.tokens && (Number(w.tokens.calls) || 0) > 0).length
  const tokensPerLoad = tokenWindows > 0 && tokens.calls > 0 ? billable / tokenWindows : null

  // Explicit feedback replaces the text-correction heuristic where it exists:
  // ratings are first-class DSH events, editable and bound to a message id.
  const feedback = { positive: 0, negative: 0, categories: {} as Record<string, number>, notes: [] as string[] }
  const outcomes = {
    deliverables: 0,
    workspaceChanges: 0,
    jobsSettled: 0,
    jobsFailed: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    workflowRuns: 0,
  }
  const approvals = { asked: 0, decided: 0, rejected: 0 }
  const models: Record<string, number> = Object.create(null)
  const presets: Record<string, number> = Object.create(null)
  const agentKinds: Record<string, number> = Object.create(null)
  let compactions = 0
  const withOutcome = (w: WindowRecord) => {
    const o = w.outcomes
    if (!o) return false
    return (
      (Number(o.deliverables) || 0) +
        (Number(o.workspaceChanges) || 0) +
        (Number(o.jobsSettled) || 0) +
        (Number(o.tasksCompleted) || 0) +
        (Number(o.workflowRuns) || 0) >
      0
    )
  }
  let outcomeWindows = 0
  let compactionWindows = 0
  for (const w of windows) {
    const f = w.feedback
    if (f && typeof f === 'object') {
      feedback.positive += Number(f.positive) || 0
      feedback.negative += Number(f.negative) || 0
      for (const [category, count] of Object.entries(f.categories ?? {})) {
        if (!category) continue
        feedback.categories[category] = (feedback.categories[category] ?? 0) + (Number(count) || 0)
      }
      for (const note of Array.isArray(f.notes) ? f.notes : []) {
        if (typeof note === 'string' && note && feedback.notes.length < 4) feedback.notes.push(note)
      }
    }
    const o = w.outcomes
    if (o && typeof o === 'object') {
      for (const key of Object.keys(outcomes) as Array<keyof typeof outcomes>) {
        outcomes[key] += Number(o[key]) || 0
      }
      if (withOutcome(w)) outcomeWindows += 1
    }
    const a = w.approvals
    if (a && typeof a === 'object') {
      approvals.asked += Number(a.asked) || 0
      approvals.decided += Number(a.decided) || 0
      approvals.rejected += Number(a.rejected) || 0
    }
    const c = w.context
    if (c && typeof c === 'object') {
      compactions += Number(c.compactions) || 0
      if ((Number(c.compactions) || 0) > 0) compactionWindows += 1
    }
    const m = w.model
    if (m && typeof m === 'object') {
      const modelKey = [m.provider, m.model].filter((x) => typeof x === 'string' && x).join('/') || 'unknown'
      models[modelKey] = (models[modelKey] ?? 0) + 1
      if (typeof m.preset === 'string' && m.preset) presets[m.preset] = (presets[m.preset] ?? 0) + 1
    }
    if (typeof w.agentKind === 'string' && w.agentKind) agentKinds[w.agentKind] = (agentKinds[w.agentKind] ?? 0) + 1
  }
  const feedbackTotal = feedback.positive + feedback.negative

  return {
    loads,
    closed: closed.length,
    tokens,
    tokenWindows,
    tokensPerLoad: tokensPerLoad === null ? null : Math.round(tokensPerLoad),
    billableTokens: Math.round(billable),
    open: loads - closed.length,
    loadOk,
    loadOkRate: loads > 0 ? loadOk / loads : null,
    loadErrors: safe
      .map((s) => s.error)
      .filter((e): e is string => Boolean(e))
      .slice(-5),
    toolCalls,
    errors,
    errRate: toolCalls > 0 ? errors / toolCalls : null,
    mcp,
    loopErrors,
    llmRetries,
    loopErrorRate: windows.length > 0 ? withLoopError / windows.length : null,
    loopErrorNames,
    correctionRate: windows.length > 0 ? withCorrection / windows.length : null,
    abandonRate: abandonBase.length > 0 ? abandonedRoot / abandonBase.length : null,
    abandonBase: abandonBase.length,
    siblingRate: windows.length > 0 ? withSibling / windows.length : null,
    avgCalls: windows.length > 0 ? toolCalls / windows.length : null,
    p50LoadMs: median(safe.map((s) => s.loadMs)),
    corrections: corrections.slice(-5),
    siblings,
    errorNames,
    feedback,
    feedbackTotal,
    feedbackNegativeRate: feedbackTotal > 0 ? feedback.negative / feedbackTotal : null,
    outcomes,
    outcomeRate: windows.length > 0 ? outcomeWindows / windows.length : null,
    approvals,
    compactions,
    compactionWindows,
    compactionPerLoad: windows.length > 0 ? compactions / windows.length : null,
    models,
    presets,
    agentKinds,
  }
}

// ---------------------------------------------------------------------------
// Scoring.
// ---------------------------------------------------------------------------

export type Stats = ReturnType<typeof aggregate>

function reliabilityScore(stats: Stats): number | null {
  if (stats.loads === 0) return null
  const loadOk = stats.loadOkRate ?? 0
  // A 50% post-load tool error rate zeroes the error half.
  const cleanWindow = stats.errRate === null ? 1 : 1 - clamp(stats.errRate * 2, 0, 1)
  // The agent loop itself failing right after a load (a broken step, a failed
  // model request, an aborted batch) is the skill's problem too, but it is a
  // weaker signal than a tool error, so it costs at most 40% of the dimension.
  const loopPenalty = 1 - 0.4 * clamp(stats.loopErrorRate ?? 0, 0, 1)
  // A load failure makes the skill unusable, so it multiplies the whole
  // dimension instead of only the load half: 0% load success = 0 reliability.
  return clamp(100 * loadOk * (0.6 + 0.4 * cleanWindow) * loopPenalty, 0, 100)
}

function effectivenessScore(stats: Stats): number | null {
  if (stats.closed === 0) return null
  let score = 100
  // Explicit ratings are the strongest effectiveness signal. Text corrections
  // remain the fallback only where no rating exists, so a liked run cannot be
  // dragged down by an unrelated follow-up message.
  if (stats.feedbackTotal > 0) score -= 50 * (stats.feedbackNegativeRate ?? 0)
  else score -= 45 * (stats.correctionRate ?? 0)
  score -= 25 * (stats.abandonRate ?? 0)
  score -= 20 * (stats.siblingRate ?? 0)
  score -= 10 * clamp(stats.errRate ?? 0, 0, 1)
  // Deliverables, workspace changes, settled jobs and completed team tasks are
  // positive outcome evidence: work that produced something beats silence.
  score += 8 * (stats.outcomeRate ?? 0)
  return clamp(score, 0, 100)
}

function efficiencyScore(stats: Stats, tokenBudgetPerLoad = 20000): number | null {
  if (stats.closed === 0) return null
  let score = 100
  const calls = stats.avgCalls ?? 0
  if (calls > 8) score -= Math.min(40, (calls - 8) * 6)
  if (calls < 1) score -= 15
  const ms = stats.p50LoadMs
  if (ms !== null && Number.isFinite(ms) && ms > 2000) score -= Math.min(30, (ms - 2000) / 100)
  // Measured billable tokens per load: double the budget costs 30 points.
  const perLoad = stats.tokensPerLoad
  if (perLoad !== null && Number.isFinite(perLoad) && perLoad > tokenBudgetPerLoad) {
    score -= Math.min(35, ((perLoad - tokenBudgetPerLoad) / tokenBudgetPerLoad) * 30)
  }
  // Context pressure is real cost: a load that forces compaction burns the
  // window's working memory. One compaction per load costs up to 20 points.
  const compactionPerLoad = stats.compactionPerLoad ?? 0
  if (compactionPerLoad > 0) score -= Math.min(20, compactionPerLoad * 10)
  return clamp(score, 0, 100)
}

/**
 * Composite score. Dimensions that have no evidence (no samples / unresolvable
 * skill) are dropped and their weight is redistributed over the rest, so a
 * brand-new skill is not punished for having no history.
 * Partial weights merge over the defaults: passing { reliability: 0.5 } only
 * overrides that dimension instead of zeroing the other three.
 */
export function scoreSkill({
  stats,
  static: staticDim,
  weights = DEFAULT_WEIGHTS,
  thresholds = DEFAULT_THRESHOLDS,
  minSamples = 3,
  tokenBudgetPerLoad = 20000,
}: {
  stats: Stats
  static?: { score?: number | null } | null
  weights?: Partial<Weights>
  thresholds?: Partial<Thresholds>
  minSamples?: number
  tokenBudgetPerLoad?: number
}) {
  const dims: Record<keyof Weights, number | null> = {
    static: staticDim?.score ?? null,
    reliability: reliabilityScore(stats),
    effectiveness: effectivenessScore(stats),
    efficiency: efficiencyScore(stats, tokenBudgetPerLoad),
  }
  // Merge partial overrides over the defaults, sanitize, and fall back to the
  // defaults when nothing positive remains. Direct callers (tests, scripts)
  // must get the same semantics as report.normalizeWeights.
  const merged: Record<keyof Weights, number> = { ...DEFAULT_WEIGHTS, ...(weights ?? {}) }
  for (const key of Object.keys(merged) as Array<keyof Weights>) {
    const w = Number(merged[key])
    merged[key] = Number.isFinite(w) && w > 0 ? w : 0
  }
  if (!Object.values(merged).some((w) => w > 0)) Object.assign(merged, DEFAULT_WEIGHTS)
  // Sort inverted threshold overrides (e.g. {excellent:50, good:90}) instead of
  // trusting caller order; gradeOf assumes excellent>=good>=pass.
  const bands = [thresholds.excellent ?? 90, thresholds.good ?? 80, thresholds.pass ?? 70]
    .map((v) => (Number.isFinite(Number(v)) && Number(v) > 0 && Number(v) <= 100 ? Number(v) : NaN))
    .map((v, i) => (Number.isFinite(v) ? v : [90, 80, 70][i]))
    .sort((a, b) => b - a)
  const cleanThresholds = { excellent: bands[0], good: bands[1], pass: bands[2] }
  let weighted = 0
  let weightSum = 0
  const used: Partial<Weights> = {}
  for (const key of Object.keys(dims) as Array<keyof Weights>) {
    const value = dims[key]
    if (value === null || value === undefined || !Number.isFinite(value)) continue
    const w = merged[key]
    if (!(w > 0)) continue
    weighted += value * w
    weightSum += w
    used[key] = w
  }
  const total = weightSum > 0 ? round(weighted / weightSum, 1) : null
  const confidence =
    stats.loads === 0 ? 'none' : stats.loads < minSamples ? 'low' : stats.loads < minSamples * 3 ? 'medium' : 'high'
  return {
    total,
    grade: gradeOf(total, cleanThresholds),
    provisional: stats.loads < minSamples,
    confidence,
    samples: stats.loads,
    minSamples,
    dimensions: dims,
    effectiveWeights: used,
    coverage: round(weightSum, 2),
  }
}

/**
 * Bootstrap interval for a call-weighted rate. Advice reports "X% of the tool
 * calls inside the window failed", so its noise floor must resample calls, not
 * the fraction of windows that contain any error: one severe window can
 * otherwise be gated away by nine clean one-call windows.
 */
export function bootstrapCallRate(
  windows: unknown,
  options: { resamples?: number; seed?: number } = {},
): Interval | null {
  const rows: WindowRecord[] = Array.isArray(windows) ? windows.filter(Boolean) : []
  const resamples = finiteOr(options.resamples, 400)
  if (rows.length < 2 || resamples <= 0) return null
  const totalCalls = rows.reduce((sum, w) => sum + (Number(w.toolCalls) || 0), 0)
  const totalErrors = rows.reduce((sum, w) => sum + (Number(w.errors) || 0), 0)
  if (!(totalCalls > 0)) return null
  const random = mulberry32(finiteOr(options.seed, 1))
  const rates: number[] = []
  for (let i = 0; i < resamples; i += 1) {
    let calls = 0
    let errors = 0
    for (let j = 0; j < rows.length; j += 1) {
      const w = rows[Math.floor(random() * rows.length)]
      calls += Number(w.toolCalls) || 0
      errors += Number(w.errors) || 0
    }
    if (calls > 0) rates.push(errors / calls)
  }
  if (rates.length === 0) return null
  rates.sort((a, b) => a - b)
  // Nearest-rank quantile: Math.round() collapses small-n intervals to a
  // single discrete point; ceil keeps the 2.5%/97.5% ranks honest.
  const at = (p: number) => rates[Math.min(rates.length - 1, Math.max(0, Math.ceil(p * rates.length) - 1))]
  return {
    mean: Math.min(1, totalErrors / totalCalls),
    low: at(0.025),
    high: at(0.975),
    resamples: rates.length,
    windows: rows.length,
    calls: totalCalls,
  }
}

export function bootstrapRate<T>(
  windows: readonly T[] | null | undefined,
  isHit: (row: T) => boolean,
  options: { resamples?: number; seed?: number } = {},
): Interval | null {
  const rows: T[] = Array.isArray(windows) ? windows.filter(Boolean) : []
  const resamples = finiteOr(options.resamples, 400)
  if (rows.length < 2 || resamples <= 0) return null
  const random = mulberry32(finiteOr(options.seed, 1))
  const rates: number[] = []
  for (let i = 0; i < resamples; i += 1) {
    let hits = 0
    for (let j = 0; j < rows.length; j += 1) if (isHit(rows[Math.floor(random() * rows.length)])) hits += 1
    rates.push(hits / rows.length)
  }
  rates.sort((a, b) => a - b)
  const at = (p: number) => rates[Math.min(rates.length - 1, Math.max(0, Math.ceil(p * rates.length) - 1))]
  const mean = rows.filter(isHit).length / rows.length
  return { mean, low: at(0.025), high: at(0.975), resamples: rates.length, windows: rows.length }
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}
