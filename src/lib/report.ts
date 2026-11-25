import { EventStore, resolveDataDir, foldSamples } from './store.ts'
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, aggregate, scoreSkill, staticProfile } from './score.ts'
import { EDIT_DIMENSIONS } from './dimensions.ts'
import { bootstrapCI, type Interval95 } from './stats.ts'
import { buildLoopPlans } from './loop.ts'
import type { LoopPlans } from './loop.ts'
import { mcpServers, runsOf, scoreRun, turnLoads, type Run, type RunScore } from './runs.ts'
import { buildAdvice, buildMcpAdvice, topAdvice } from './advice.ts'
import { buildValidity } from './validity.ts'
import { buildSteps, summarizeSteps, type Step } from './steps.ts'
import { hashSeed } from './random.ts'
import type { FoldedSample } from './store.ts'
import type { Host, StoredRecord, Thresholds, Weights } from './types.ts'

export { bootstrapCI, type Interval95 }
export type { Run, RunScore }
export { mcpServers, runsOf, scoreRun, turnLoads }

/** Settings the analyzer reads; every field is optional and defaulted below. */
export interface AnalyzerConfig {
  dataDir?: string
  weights?: Partial<Weights> | null
  thresholds?: Partial<Thresholds> | null
  minSamples?: number
  cacheReadWeight?: number
  tokenBudgetPerLoad?: number
  ciResamples?: number
  adviceNoiseFloor?: boolean
  pruneMinLoads?: number
  pruneMaxScore?: number
  maxAdvice?: number
  editBudgetMax?: number
  editBudgetMin?: number
  editBudgetHorizon?: number
  noveltyWindow?: number
  mcpErrorRatePercent?: number
  mcpToolErrorRatePercent?: number
  mcpP95Ms?: number
  mcpToolP95Ms?: number
}

interface Rankable {
  skill: string
  score?: { total?: number | null; ci?: { low: number; high: number } | null } | null
}

export interface Ranking {
  significant: boolean | null
  note: string | null
  noteZh?: string
  ties: Array<{ a: string; b: string; aTotal: number; bTotal: number }>
}

/**
 * Two skills whose intervals overlap are not ordered by the data. Reporting a
 * rank without saying that is how a "top fix" list turns into a wild goose
 * chase, so the report carries an explicit ranking note. Overlap alone decides
 * significance — the point-estimate gap only affects the wording, never the
 * verdict.
 */
export function rankingOf(entries: readonly (Rankable | null)[] | null | undefined): Ranking {
  const scored = (entries ?? []).filter(
    (entry): entry is Rankable & { score: { total: number; ci: { low: number; high: number } } } =>
      Boolean(entry && entry.score && entry.score.ci && typeof entry.score.total === 'number'),
  )
  // Fewer than two intervals means nothing was compared; claiming a
  // significant ranking here would be a fabricated statistic.
  if (scored.length < 2)
    return { significant: null, note: 'not enough scored skills with 95% intervals to rank them', ties: [] }
  // Sort defensively: callers normally pre-sort, but significance must not
  // depend on input order. Only adjacent pairs in total-order need checking —
  // non-adjacent overlap always implies an adjacent overlap in between.
  const ordered = [...scored].sort((a, b) => (b.score.total ?? 0) - (a.score.total ?? 0))
  const ties: Ranking['ties'] = []
  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1]
    const b = ordered[i]
    const overlap = a.score.ci.low <= b.score.ci.high && b.score.ci.low <= a.score.ci.high
    if (overlap) ties.push({ a: a.skill, b: b.skill, aTotal: a.score.total, bTotal: b.score.total })
  }
  if (ties.length === 0) return { significant: true, note: null, ties: [] }
  const first = ties[0]
  return {
    significant: false,
    ties,
    note: `rank is not significant: "${first.a}" (${first.aTotal}) and "${first.b}" (${first.bTotal}) have overlapping 95% intervals — treat them as a tie and fix the evidence, not the order`,
    noteZh: `排名不显著：“${first.a}”（${first.aTotal}）与“${first.b}”（${first.bTotal}）的 95% 区间重叠 —— 当作平手，去补证据，不要纠结顺序`,
  }
}

/** @deprecated import via ./dimensions instead; kept for compatibility. */
export { EDIT_DIMENSIONS }

/** Measured effect of the latest reviewed edit on this skill. */
export interface EditImpact {
  at: number
  dimension: string | null
  verdict: string | null
  hypothesis: string | null
  before: { score: number | null; loads: number }
  after: { score: number | null; loads: number }
  delta: number | null
  /** True only when both sides have enough loads and their 95% intervals separate. */
  significant: boolean
  direction: 'improved' | 'regressed' | 'flat' | 'insufficient'
}

/** One reviewed edit's effect against the segment immediately before it. */
export interface EditPoint {
  at: number
  dimension: string | null
  verdict: string | null
  hypothesis: string | null
  before: { score: number | null; loads: number }
  after: { score: number | null; loads: number }
  delta: number | null
}

/**
 * Segment a skill's samples between consecutive edits and report each edit's
 * effect against the segment right before it. This shows whether successive
 * changes are still moving the score, instead of only comparing the latest
 * edit with the entire history.
 */
export function editHistoryOf({
  edits,
  samples,
  score,
}: {
  edits: readonly { at?: unknown; dimension?: unknown; verdict?: unknown; hypothesis?: unknown }[] | null | undefined
  samples: readonly FoldedSample[]
  score: (subset: FoldedSample[]) => number | null
}): EditPoint[] {
  const ordered = (edits ?? [])
    .filter((edit) => edit && Number.isFinite(Number(edit.at)))
    .map((edit) => ({ ...edit, at: Number(edit.at) }))
    .sort((a, b) => a.at - b.at)
  const seen = new Set<number>()
  const unique: typeof ordered = []
  for (const edit of ordered) {
    if (seen.has(edit.at)) continue
    seen.add(edit.at)
    unique.push(edit)
  }
  return unique.map((edit, index) => {
    const lower = index === 0 ? -Infinity : unique[index - 1].at
    const upper = unique[index + 1]?.at ?? Infinity
    const beforeSamples = samples.filter((sample) => {
      const at = Number(sample.at)
      return Number.isFinite(at) && at >= lower && at < edit.at
    })
    const afterSamples = samples.filter((sample) => {
      const at = Number(sample.at)
      return Number.isFinite(at) && at >= edit.at && at < upper
    })
    const beforeScore = beforeSamples.length > 0 ? score(beforeSamples) : null
    const afterScore = afterSamples.length > 0 ? score(afterSamples) : null
    const delta =
      typeof beforeScore === 'number' && typeof afterScore === 'number'
        ? Math.round((afterScore - beforeScore) * 10) / 10
        : null
    return {
      at: edit.at,
      dimension: typeof edit.dimension === 'string' ? edit.dimension : null,
      verdict: typeof edit.verdict === 'string' ? edit.verdict : null,
      hypothesis: typeof edit.hypothesis === 'string' ? edit.hypothesis.slice(0, 200) : null,
      before: { score: beforeScore, loads: beforeSamples.length },
      after: { score: afterScore, loads: afterSamples.length },
      delta,
    }
  })
}

/**
 * Split a skill's samples around its latest reviewed edit and compare the
 * before/after total. This is the only honest way to answer "did the edit
 * help?": the edit ledger says what changed, the windows say what happened.
 */
export function editImpactOf({
  edits,
  samples,
  minimum,
  score,
  ci,
}: {
  edits: readonly { at?: unknown; dimension?: unknown; verdict?: unknown; hypothesis?: unknown }[] | null | undefined
  samples: readonly FoldedSample[]
  minimum: number
  score: (subset: FoldedSample[]) => number | null
  ci: (subset: FoldedSample[]) => Interval95 | null
}): EditImpact | null {
  const latest = (edits ?? [])
    .filter((edit) => edit && Number.isFinite(Number(edit.at)))
    .sort((a, b) => Number(b.at) - Number(a.at))[0]
  if (!latest) return null
  const at = Number(latest.at)
  const before = samples.filter((sample) => Number.isFinite(Number(sample.at)) && Number(sample.at) < at)
  const after = samples.filter((sample) => Number.isFinite(Number(sample.at)) && Number(sample.at) >= at)
  if (before.length === 0 && after.length === 0) return null
  const beforeScore = before.length > 0 ? score(before) : null
  const afterScore = after.length > 0 ? score(after) : null
  const delta =
    typeof beforeScore === 'number' && typeof afterScore === 'number'
      ? Math.round((afterScore - beforeScore) * 10) / 10
      : null
  let significant = false
  if (before.length >= minimum && after.length >= minimum) {
    const beforeCi = ci(before)
    const afterCi = ci(after)
    significant = Boolean(beforeCi && afterCi && (afterCi.low > beforeCi.high || beforeCi.low > afterCi.high))
  }
  const direction: EditImpact['direction'] = !significant
    ? 'insufficient'
    : delta === null || Math.abs(delta) < 1
      ? 'flat'
      : delta > 0
        ? 'improved'
        : 'regressed'
  return {
    at,
    dimension: typeof latest.dimension === 'string' ? latest.dimension : null,
    verdict: typeof latest.verdict === 'string' ? latest.verdict : null,
    hypothesis: typeof latest.hypothesis === 'string' ? latest.hypothesis.slice(0, 200) : null,
    before: { score: beforeScore, loads: before.length },
    after: { score: afterScore, loads: after.length },
    delta,
    significant,
    direction,
  }
}

/**
 * RRSI's annealed edit budget: early iterations may carry a bundle of edits,
 * later ones shrink to a single attributable change. Here "iteration" is the
 * number of edits this skill already had accepted.
 */
export function annealedBudget(
  accepted: unknown,
  { max = 4, min = 1, horizon = 6 }: { max?: number; min?: number; horizon?: number } = {},
): number {
  const hi = Math.max(1, Math.trunc(max))
  const lo = Math.max(1, Math.min(hi, Math.trunc(min)))
  const steps = Math.max(1, Math.trunc(horizon))
  const progress = Math.min(1, Math.max(0, Number(accepted) || 0) / steps)
  const value = Math.round(hi - (hi - lo) * ((1 - Math.cos(Math.PI * progress)) / 2))
  return Math.max(lo, Math.min(hi, value))
}

/**
 * Directional exploration: if the last edits all targeted one dimension, the
 * next change should exercise a dimension the run has not touched.
 */
export function explorationDirective(
  edits: readonly ({ dimension?: unknown } | null)[] | null | undefined,
  { window = 2 }: { window?: number } = {},
): { stuck: string; suggestion: string; reason: string } | null {
  const recent = (edits ?? []).filter((entry): entry is { dimension: string } =>
    Boolean(entry && typeof entry.dimension === 'string'),
  )
  if (recent.length < Math.max(2, window)) return null
  const tail = recent.slice(-Math.max(2, window))
  const stuck = tail[0].dimension
  if (!tail.every((entry) => entry.dimension === stuck)) return null
  const used = new Map<string, number>()
  for (const entry of recent) used.set(entry.dimension, (used.get(entry.dimension) ?? 0) + 1)
  const suggestion = EDIT_DIMENSIONS.filter((dimension) => dimension !== stuck).sort(
    (a, b) => (used.get(a) ?? 0) - (used.get(b) ?? 0),
  )[0]
  return {
    stuck,
    suggestion,
    reason: `last ${tail.length} reviewed edit(s) all targeted "${stuck}"`,
  }
}

/** Accept any positive relative weights (0-1 or percent) and normalise them. */
export function normalizeWeights(input: unknown = {}): Weights {
  const raw: Record<string, unknown> = { ...DEFAULT_WEIGHTS, ...(input && typeof input === 'object' ? input : {}) }
  const cleaned = {} as Weights
  let sum = 0
  for (const key of Object.keys(DEFAULT_WEIGHTS) as Array<keyof Weights>) {
    const value = Number(raw[key])
    const weight = Number.isFinite(value) && value > 0 ? value : 0
    cleaned[key] = weight
    sum += weight
  }
  if (!(sum > 0)) return { ...DEFAULT_WEIGHTS }
  const out = {} as Weights
  for (const key of Object.keys(cleaned) as Array<keyof Weights>)
    out[key] = Math.round((cleaned[key] / sum) * 1000) / 1000
  return out
}

/**
 * Display weights as integers that always sum to exactly 100. Independent
 * rounding can show 29+29+29+14=101 for a legal 2/2/2/1 configuration, which
 * then fails the release check; largest-remainder keeps the displayed total
 * honest. Unnormalized or all-zero input is normalized first (zeros stay zero).
 */
export function percentWeights(weights: Record<string, unknown> | null | undefined): Record<string, number> {
  const keys = Object.keys(weights ?? {})
  if (keys.length === 0) return {}
  const raws = keys.map((key) => {
    const n = Number(weights?.[key])
    return Number.isFinite(n) && n > 0 ? n : 0
  })
  const total = raws.reduce((sum, value) => sum + value, 0)
  if (!(total > 0)) return Object.fromEntries(keys.map((key) => [key, 0]))
  // Scale to a 100-point pie first so over/under-weight input still sums to 100.
  const exact = raws.map((value) => (value / total) * 100)
  const base = exact.map((value) => Math.floor(value))
  let remainder = 100 - base.reduce((sum, value) => sum + value, 0)
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac)
  // remainder is in [0, keys.length) after scaling, so one pass always suffices.
  for (const item of order) {
    if (remainder <= 0) break
    base[item.index] += 1
    remainder -= 1
  }
  return Object.fromEntries(keys.map((key, index) => [key, base[index]]))
}

export function resolveThresholds(input: unknown): Thresholds {
  const raw: Record<string, unknown> = { ...DEFAULT_THRESHOLDS, ...(input && typeof input === 'object' ? input : {}) }
  const pick = (key: string, fallback: number) => {
    const value = Number(raw[key])
    return Number.isFinite(value) && value > 0 && value <= 100 ? value : fallback
  }
  const thresholds = {
    excellent: pick('excellent', DEFAULT_THRESHOLDS.excellent),
    good: pick('good', DEFAULT_THRESHOLDS.good),
    pass: pick('pass', DEFAULT_THRESHOLDS.pass),
  }
  // Sort the three floors rather than clamping only the ends: {90, 50, 70} must
  // become A90/B70/C50, not collapse B and C onto the same value.
  const bands = [thresholds.excellent, thresholds.good, thresholds.pass].sort((a, b) => b - a)
  thresholds.excellent = bands[0]
  thresholds.good = bands[1]
  thresholds.pass = bands[2]
  return thresholds
}

/** A static profile, live from the catalog or normalised from a recorded `static` event. */
export interface StaticQuality {
  name?: string
  description?: string
  catalogDescription?: string
  catalogTruncated?: boolean
  catalogComplete?: boolean
  modelInvocable?: boolean
  whenToUse?: string
  bodyLines?: number
  sectionCount?: number
  source?: string | null
  provider?: string | null
  path?: string | null
  resolved?: boolean
  integrity?: { checked: number; missing?: string[] } | null
  checks?: Array<{
    id: string
    label?: string
    weight: number
    fraction: number | null
    points: number | null
    skipped?: boolean
  }>
  failedChecks?: Array<{ id: string; fraction: number }>
  score?: number | null
  capturedAt?: number
  origin?: string
}

/**
 * Ties the append-only store to the live skill catalog.
 *
 * The store is the only durable state; everything here is derived on demand.
 * Static profiles are cached and invalidated on `skills/change`.
 */
export function createAnalyzer(ctx: Host, config: AnalyzerConfig) {
  const store = new EventStore(resolveDataDir(config))
  const staticCache = new Map<string, StaticQuality | null>()
  let reportCache: { stamp: string; at: number; report: Report } | null = null

  const invalidate = () => {
    staticCache.clear()
    reportCache = null
  }
  const offSkillsChange = ctx.on('skills/change', invalidate)

  /**
   * Prefer the live catalog (fresh after an edit) and fall back to the static
   * profile captured at load time, which is the only path that knows the
   * agent-scoped layer the skill was resolved from.
   */
  async function catalogStatic(name: string): Promise<StaticQuality | null | undefined> {
    if (staticCache.has(name)) return staticCache.get(name)
    let profile: StaticQuality | null = null
    for (const options of [{}, { cwd: process.cwd() }]) {
      try {
        const snapshot =
          typeof ctx.skills.snapshot === 'function'
            ? await ctx.skills.snapshot(options)
            : { skills: await ctx.skills.list(options), complete: true }
        const summary = (snapshot?.skills ?? []).find((s: Host) => s.name === name)
        if (!summary) continue
        const definition = await ctx.skills.get(name, options)
        profile = staticProfile(summary, definition, { catalogComplete: snapshot?.complete !== false })
        break
      } catch {
        profile = null
      }
    }
    staticCache.set(name, profile)
    return profile
  }

  function recordedStatic(records: readonly StoredRecord[], name: string): StaticQuality | null {
    let latest: (StoredRecord & { static: Host }) | null = null
    for (const record of records) {
      if (!record || record.t !== 'static' || record.skill !== name || !record.static) continue
      if (!latest || (Number(record.at) || 0) >= (Number(latest.at) || 0))
        latest = record as StoredRecord & { static: Host }
    }
    if (!latest || !latest.static || typeof latest.static !== 'object' || Array.isArray(latest.static)) return null
    // A hand-edited or older store may hold any shape here; normalise it so one
    // bad record cannot crash advice/report rendering for every skill.
    const text = (value: unknown) =>
      typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
    const num = (value: unknown, fallback = 0) => {
      const n = Number(value)
      return Number.isFinite(n) && n >= 0 ? n : fallback
    }
    const check = (entry: Host) =>
      entry && typeof entry === 'object'
        ? { ...entry, fraction: num(entry.fraction), points: num(entry.points), weight: num(entry.weight) }
        : null
    type Check = { id: string; label?: string; fraction: number; points: number; weight: number }
    const isCheck = (entry: Check | null): entry is Check => Boolean(entry)
    const checks = (Array.isArray(latest.static.checks) ? latest.static.checks : []).map(check).filter(isCheck)
    const failedChecks = (
      Array.isArray(latest.static.failedChecks)
        ? latest.static.failedChecks
        : checks.filter((c: Check) => c.fraction < 1)
    )
      .map(check)
      .filter(isCheck)
    const integrity =
      latest.static.integrity && typeof latest.static.integrity === 'object'
        ? {
            checked: num(latest.static.integrity.checked),
            missing: Array.isArray(latest.static.integrity.missing)
              ? latest.static.integrity.missing.filter((item: unknown) => typeof item === 'string')
              : [],
          }
        : null
    return {
      name: text(latest.static.name),
      description: text(latest.static.description),
      catalogDescription: text(latest.static.catalogDescription),
      catalogTruncated: latest.static.catalogTruncated === true,
      catalogComplete: latest.static.catalogComplete !== false,
      modelInvocable: latest.static.modelInvocable !== false,
      whenToUse: text(latest.static.whenToUse),
      bodyLines: num(latest.static.bodyLines),
      sectionCount: num(latest.static.sectionCount),
      source: latest.static.source ?? null,
      provider: latest.static.provider ?? null,
      path: latest.static.path ?? null,
      resolved: latest.static.resolved === true,
      integrity,
      checks,
      score: Number.isFinite(Number(latest.static.score)) ? Number(latest.static.score) : null,
      failedChecks,
      capturedAt: latest.at,
      origin: 'recorded',
    }
  }

  async function resolveStatic(
    name: string,
    records: readonly StoredRecord[] = [],
  ): Promise<StaticQuality | null | undefined> {
    const profile = (await catalogStatic(name)) ?? recordedStatic(records, name)
    if (!profile || typeof profile !== 'object' || !('content' in profile)) return profile
    // old static records embedded the whole body; never surface it again
    const { content: _body, ...rest } = profile
    return rest
  }

  type Report = Awaited<ReturnType<typeof compute>>

  async function build(options: { skill?: string } = {}): Promise<Report> {
    // The panel polls and each turn strip asks once; reuse the last report while
    // the store has not changed (EventStore.version) and settings are unchanged.
    const stamp = await store.stamp()
    if (!options.skill && reportCache && reportCache.stamp === stamp && Date.now() - reportCache.at < 2000) {
      return reportCache.report
    }
    const report = await compute(options)
    if (!options.skill) reportCache = { stamp, at: Date.now(), report }
    return report
  }

  async function compute(options: { skill?: string }) {
    const records = await store.readAll()
    const folded = foldSamples(records)
    const weights = normalizeWeights(config.weights)
    const thresholds = resolveThresholds(config.thresholds)
    const minSamples = config.minSamples ?? 3

    const editsChronological = records.filter((record) => record && record.t === 'edit')
    const edits = [...editsChronological].reverse().slice(0, 30)
    const entries = []
    for (const group of folded) {
      if (options.skill && options.skill !== group.skill) continue
      const cacheReadWeight = config.cacheReadWeight ?? 0
      const tokenBudgetPerLoad = config.tokenBudgetPerLoad ?? 20000
      const stats = aggregate(group.samples, { cacheReadWeight })
      const sp = await resolveStatic(group.skill, records)
      // The point estimate and every bootstrap draw must use the same scoring
      // options, or the interval can exclude the score it belongs to.
      const scoreSamples = (samples: FoldedSample[]) =>
        scoreSkill({
          stats: aggregate(samples, { cacheReadWeight }),
          static: sp,
          weights,
          thresholds,
          minSamples,
          tokenBudgetPerLoad,
        })
      const score: ReturnType<typeof scoreSamples> & { ci: Interval95 | null } = {
        ...scoreSamples(group.samples),
        ci: null,
      }
      score.ci = bootstrapCI(group.samples, (draw) => scoreSamples(draw).total, {
        resamples: config.ciResamples ?? 200,
        seed: hashSeed(group.skill),
      })
      // Percentile intervals can exclude the point estimate under skew (mean vs
      // median). Expand defensively so the board never shows "88 ± [90,95]".
      if (score.ci && typeof score.total === 'number') {
        score.ci.low = Math.min(score.ci.low, Math.floor(score.total * 10) / 10)
        score.ci.high = Math.max(score.ci.high, Math.ceil(score.total * 10) / 10)
      }
      // Last few per-load scores for the panel sparkline. One sample is scored
      // with the same options as the aggregate; capped so the payload stays small.
      const trend = group.samples
        .slice(-12)
        .map((sample) => {
          const point = scoreSamples([sample])
          return point.total !== null && Number.isFinite(point.total)
            ? {
                at: Number.isFinite(Number(sample.at)) ? Number(sample.at) : null,
                total: Math.round(point.total * 10) / 10,
              }
            : null
        })
        .filter((point) => point !== null)
      const windows = group.samples.map((sample) => sample.window).filter((window) => window !== null)
      const skillEdits = editsChronological.filter((record) => record.skill === group.skill)
      const scoreSubset = (subset: FoldedSample[]): number | null => {
        const total = scoreSamples(subset).total
        return typeof total === 'number' ? total : null
      }
      const editImpact = editImpactOf({
        edits: skillEdits,
        samples: group.samples,
        minimum: minSamples,
        score: scoreSubset,
        ci: (subset) =>
          bootstrapCI(subset, (draw) => scoreSamples(draw).total, {
            resamples: config.ciResamples ?? 200,
            seed: hashSeed(group.skill + ':edit'),
          }),
      })
      const editHistory = editHistoryOf({ edits: skillEdits, samples: group.samples, score: scoreSubset })
      const advice = buildAdvice({
        stats,
        static: sp,
        score,
        minSamples,
        windows,
        editImpact,
        gating: config.adviceNoiseFloor !== false,
        tokenBudgetPerLoad: config.tokenBudgetPerLoad ?? 20000,
        pruneMinLoads: config.pruneMinLoads ?? 12,
        pruneMaxScore: config.pruneMaxScore ?? 60,
      })
      const accepted = skillEdits.filter((record) => record.verdict === 'accept').length
      const adviceBudget = annealedBudget(accepted, {
        max: config.editBudgetMax ?? 4,
        min: config.editBudgetMin ?? 1,
        horizon: config.editBudgetHorizon ?? 6,
      })
      const exploration = explorationDirective(skillEdits, { window: config.noveltyWindow ?? 2 })
      entries.push({
        skill: group.skill,
        adviceBudget,
        exploration,
        source: sp?.source ?? null,
        firstAt: group.firstAt,
        lastAt: group.lastAt,
        stats,
        staticQuality: sp,
        score,
        trend,
        editImpact,
        editHistory,
        advice,
        topAdvice: topAdvice(advice, Math.min(config.maxAdvice ?? 3, adviceBudget)),
      })
    }
    entries.sort((a, b) => (a.score.total ?? 0) - (b.score.total ?? 0))
    const skillScores = new Map(entries.map((entry) => [entry.skill, entry.score.total]))
    const ranking = rankingOf(entries)
    const mcpRows = mcpServers(entries)
    const mcpAdvice = buildMcpAdvice(mcpRows, {
      errorRate: typeof config.mcpErrorRatePercent === 'number' ? config.mcpErrorRatePercent / 100 : undefined,
      toolErrorRate:
        typeof config.mcpToolErrorRatePercent === 'number' ? config.mcpToolErrorRatePercent / 100 : undefined,
      p95Ms: typeof config.mcpP95Ms === 'number' ? config.mcpP95Ms : undefined,
      toolP95Ms: typeof config.mcpToolP95Ms === 'number' ? config.mcpToolP95Ms : undefined,
    })

    const stepLog = buildSteps(records, { thresholds, limit: 800 })
    const stepView = summarizeSteps(stepLog, { limit: 12 })
    const seenSteps = new Set<string>()
    const visibleSteps: Step[] = []
    for (const turn of stepView.turns) {
      for (const step of turn.steps) {
        const key = `${step.sessionId}#${step.turn}#${step.step}#${step.at}`
        if (seenSteps.has(key)) continue
        seenSteps.add(key)
        visibleSteps.push(step)
      }
    }
    visibleSteps.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    const report = {
      generatedAt: new Date().toISOString(),
      dataDir: store.dir,
      mcpServers: mcpRows,
      mcpAdvice,
      // The alert line the board draws on the latency chart must be the same
      // threshold the advice uses, otherwise the chart celebrates a server the
      // advice calls slow (or the reverse). The per-tool thresholds ship too so
      // the markdown report cannot disagree with mcpAdvice.
      mcp: {
        p95Ms: typeof config.mcpP95Ms === 'number' ? config.mcpP95Ms : null,
        errorRatePercent: typeof config.mcpErrorRatePercent === 'number' ? config.mcpErrorRatePercent : null,
        toolP95Ms: typeof config.mcpToolP95Ms === 'number' ? config.mcpToolP95Ms : null,
        toolErrorRatePercent:
          typeof config.mcpToolErrorRatePercent === 'number' ? config.mcpToolErrorRatePercent : null,
      },
      runs: runsOf(records, skillScores, thresholds, minSamples, config.ciResamples ?? 200),
      turnLoads: turnLoads(records),
      steps: visibleSteps,
      stepTurns: stepView.turns,
      stepOverall: stepView.overall,
      edits,
      validity: buildValidity(
        {
          skills: entries,
          edits,
          scoring: { minSamples: config.minSamples ?? 3, resamples: config.ciResamples ?? 200 },
          ranking,
        },
        { minSamples: config.minSamples ?? 3 },
      ),
      ranking,
      scoring: {
        weights,
        weightsPercent: percentWeights(weights),
        thresholds,
        minSamples,
        editBudgetMax: config.editBudgetMax ?? 4,
        customizable: true,
      },
      totals: {
        invocations: records.filter((r) => r && r.t === 'skill').length,
        skills: entries.length,
        closed: entries.reduce((n, e) => n + e.stats.closed, 0),
        open: entries.reduce((n, e) => n + e.stats.open, 0),
        storeError: store.failed,
      },
      skills: entries,
    }
    // Guided-optimization plans are computed once here (top 3 by expected
    // gain/cost) so the HTML board consumes data instead of invoking the
    // planner itself. The `loop` tool view still builds full plans on demand.
    const loopPlans: LoopPlans = buildLoopPlans(report, { editBudgetMax: config.editBudgetMax ?? 4 }).slice(0, 3)
    return { ...report, loopPlans }
  }

  async function buildOne(name: string): Promise<Report['skills'][number] | null> {
    const report = await build({ skill: name })
    return report.skills[0] ?? null
  }

  return {
    build,
    buildOne,
    store,
    invalidate,
    resolveStatic,
    dispose() {
      try {
        if (typeof offSkillsChange === 'function') offSkillsChange()
      } catch {
        // best effort teardown
      }
    },
  }
}

export type Analyzer = ReturnType<typeof createAnalyzer>
export type Report = Awaited<ReturnType<Analyzer['build']>>
export type SkillEntry = Report['skills'][number]
