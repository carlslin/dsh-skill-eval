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
import { mulberry32 } from './random.js'

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

export function gradeOf(score, thresholds = DEFAULT_THRESHOLDS) {
  if (score === null || score === undefined || score === '') return '?'
  const s = Number(score)
  if (!Number.isFinite(s)) return '?'
  const bands = [
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
export function isCorrection(text) {
  if (typeof text !== 'string' || text.length === 0) return false
  const t = text.trim().slice(0, 400)
  if (t.length === 0) return false
  return CORRECTION_PATTERNS.some((re) => re.test(t))
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n))
}

function round(n, digits = 1) {
  if (!Number.isFinite(n)) return null
  const f = 10 ** digits
  return Math.round(n * f) / f
}

export function median(nums) {
  const xs = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 === 1 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

// ---------------------------------------------------------------------------
// Static (authoring) quality — the "audit" dimension.
// ---------------------------------------------------------------------------

const STATIC_CHECKS = [
  {
    id: 'desc-length',
    weight: 12,
    label: 'description length',
    evaluate: (s) => {
      const n = (s.description ?? '').length
      if (n >= 60) return 1
      if (n >= 30) return 0.5
      return 0
    },
  },
  {
    id: 'desc-trigger',
    weight: 12,
    label: 'description states when to use it',
    evaluate: (s) =>
      /use when|when to use|triggers?|适用|适用于|当用户|用于|使用场景/i.test(s.description ?? '') ? 1 : 0,
  },
  {
    id: 'when-to-use',
    weight: 8,
    label: 'explicit whenToUse field',
    evaluate: (s) => ((s.whenToUse ?? '').trim().length > 0 ? 1 : 0),
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
    // excluded from the static score instead of pretending to pass.
    evaluate: (s) => {
      const integrity = s.integrity
      if (!integrity || typeof integrity.checked !== 'number') return null
      if (integrity.checked === 0) return 1
      const missing = integrity.missing?.length ?? 0
      return (integrity.checked - missing) / integrity.checked
    },
  },
]

/**
 * Build the static profile from a skill summary + loaded definition.
 * Returns null when the skill cannot be resolved at all (deleted provider etc.).
 */
export function staticProfile(summary, definition, options = {}) {
  if (!summary) return null
  const content = typeof definition?.content === 'string' ? definition.content : ''
  const bodyLines = content.length === 0 ? 0 : content.split('\n').length
  const sectionCount = (content.match(/^##\s+\S/gm) ?? []).length
  const view = {
    name: summary.name,
    description: summary.description ?? '',
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
      return { id: c.id, label: c.label, weight: c.weight, fraction: null, points: 0, skipped: true }
    }
    const fraction = clamp(Number(evaluated) || 0, 0, 1)
    return { id: c.id, label: c.label, weight: c.weight, fraction, points: round(c.weight * fraction, 1) }
  })
  const checks = raw
  const counted = checks.filter((c) => !c.skipped)
  const earned = counted.reduce((a, c) => a + c.weight * c.fraction, 0)
  const totalWeight = counted.reduce((a, c) => a + c.weight, 0)
  // The full body is only needed while the checks run; persisting it would
  // duplicate every SKILL.md into the append-only store and every report JSON.
  const { content: _body, ...persisted } = view
  return {
    ...persisted,
    checks,
    score: round((earned / totalWeight) * 100, 1),
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
export function aggregate(samples, options = {}) {
  const safe = Array.isArray(samples) ? samples.filter(Boolean) : []
  const loads = safe.length
  const loadOk = safe.filter((s) => s.ok).length
  const closed = safe.filter((s) => s.window)
  const windows = closed.map((s) => s.window)

  const count = (value) => {
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
  const abandonedRoot = abandonBase.filter((w) => count(w.toolCalls) === 0).length

  const withLoopError = windows.filter((w) => count(w.loopErrors) > 0).length
  const loopErrors = windows.reduce((a, w) => a + count(w.loopErrors), 0)
  const llmRetries = windows.reduce((a, w) => a + count(w.llmRetries), 0)
  const loopErrorNames = Object.create(null)
  for (const w of windows) {
    if (typeof w.lastLoopError === 'string' && w.lastLoopError) {
      loopErrorNames[w.lastLoopError] = (loopErrorNames[w.lastLoopError] ?? 0) + 1
    }
  }

  // MCP health is independent of which skill was loaded: merge every window's
  // per-server bucket so the report can show a board per MCP server.
  const mcp = Object.create(null)
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
  const siblings = Object.create(null)
  for (const w of windows) {
    for (const s of Array.isArray(w.otherSkills) ? w.otherSkills : []) {
      if (typeof s === 'string' && s) siblings[s] = (siblings[s] ?? 0) + 1
    }
  }
  const errorNames = Object.create(null)
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
  const cacheWeight = Number.isFinite(options.cacheReadWeight) ? options.cacheReadWeight : 0
  const billable = tokens.input + tokens.output + tokens.cacheRead * cacheWeight
  // Only windows that actually carried model usage count: older windows were
  // recorded before token capture existed and would dilute the per-load cost.
  const tokenWindows = windows.filter((w) => w.tokens && (Number(w.tokens.calls) || 0) > 0).length
  const tokensPerLoad = tokenWindows > 0 && tokens.calls > 0 ? billable / tokenWindows : null

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
    loadErrors: safe.map((s) => s.error).filter(Boolean),
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
  }
}

// ---------------------------------------------------------------------------
// Scoring.
// ---------------------------------------------------------------------------

function reliabilityScore(stats) {
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

function effectivenessScore(stats) {
  if (stats.closed === 0) return null
  let score = 100
  score -= 45 * (stats.correctionRate ?? 0)
  score -= 25 * (stats.abandonRate ?? 0)
  score -= 20 * (stats.siblingRate ?? 0)
  score -= 10 * clamp(stats.errRate ?? 0, 0, 1)
  return clamp(score, 0, 100)
}

function efficiencyScore(stats, tokenBudgetPerLoad = 20000) {
  if (stats.closed === 0) return null
  let score = 100
  const calls = stats.avgCalls ?? 0
  if (calls > 8) score -= Math.min(40, (calls - 8) * 6)
  if (calls < 1) score -= 15
  const ms = stats.p50LoadMs
  if (Number.isFinite(ms) && ms > 2000) score -= Math.min(30, (ms - 2000) / 100)
  // Measured billable tokens per load: double the budget costs 30 points.
  const perLoad = stats.tokensPerLoad
  if (Number.isFinite(perLoad) && perLoad > tokenBudgetPerLoad) {
    score -= Math.min(35, ((perLoad - tokenBudgetPerLoad) / tokenBudgetPerLoad) * 30)
  }
  return clamp(score, 0, 100)
}

/**
 * Composite score. Dimensions that have no evidence (no samples / unresolvable
 * skill) are dropped and their weight is redistributed over the rest, so a
 * brand-new skill is not punished for having no history.
 */
export function scoreSkill({
  stats,
  static: staticDim,
  weights = DEFAULT_WEIGHTS,
  thresholds = DEFAULT_THRESHOLDS,
  minSamples = 3,
  tokenBudgetPerLoad = 20000,
}) {
  const dims = {
    static: staticDim?.score ?? null,
    reliability: reliabilityScore(stats),
    effectiveness: effectivenessScore(stats),
    efficiency: efficiencyScore(stats, tokenBudgetPerLoad),
  }
  let weighted = 0
  let weightSum = 0
  const used = {}
  for (const key of Object.keys(dims)) {
    const value = dims[key]
    if (value === null || value === undefined || !Number.isFinite(value)) continue
    const w = Number(weights[key] ?? 0)
    if (w <= 0) continue
    weighted += value * w
    weightSum += w
    used[key] = w
  }
  const total = weightSum > 0 ? round(weighted / weightSum, 1) : null
  const confidence =
    stats.loads === 0 ? 'none' : stats.loads < minSamples ? 'low' : stats.loads < minSamples * 3 ? 'medium' : 'high'
  return {
    total,
    grade: gradeOf(total, thresholds),
    provisional: stats.loads < minSamples,
    confidence,
    samples: stats.loads,
    dimensions: dims,
    effectiveWeights: used,
    coverage: round(weightSum, 2),
  }
}

/**
 * Bootstrap interval for a rate measured over windows (correction rate, error
 * rate, ...). Advice uses it as a noise floor: a rule only keeps its severity
 * when the interval's low end is already past the threshold.
 */
export function bootstrapRate(windows, isHit, options = {}) {
  const rows = Array.isArray(windows) ? windows.filter(Boolean) : []
  const resamples = Number.isFinite(options.resamples) ? options.resamples : 400
  if (rows.length < 2 || resamples <= 0) return null
  const random = mulberry32(Number.isFinite(options.seed) ? options.seed : 1)
  const rates = []
  for (let i = 0; i < resamples; i += 1) {
    let hits = 0
    for (let j = 0; j < rows.length; j += 1) if (isHit(rows[Math.floor(random() * rows.length)])) hits += 1
    rates.push(hits / rows.length)
  }
  rates.sort((a, b) => a - b)
  const at = (p) => rates[Math.min(rates.length - 1, Math.max(0, Math.round(p * (rates.length - 1))))]
  const mean = rows.filter(isHit).length / rows.length
  return { mean, low: at(0.025), high: at(0.975), resamples: rates.length, windows: rows.length }
}
