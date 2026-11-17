import { EventStore, resolveDataDir, foldSamples } from './store.js'
import { DEFAULT_THRESHOLDS, DEFAULT_WEIGHTS, aggregate, gradeOf, scoreSkill, staticProfile } from './score.js'
import { buildAdvice, buildMcpAdvice, topAdvice } from './advice.js'
import { buildValidity } from './validity.js'
import { buildSteps, summarizeSteps } from './steps.js'
import { hashSeed, mulberry32 } from './random.js'

/**
 * Bootstrap 95% interval over the recorded loads.
 *
 * The score is a point estimate over a handful of runs, so "88" and "88 ± 9"
 * are very different claims. Resampling the loads (with replacement) and
 * re-scoring gives an honest interval without assuming a distribution.
 */
export function bootstrapCI(samples, compute, options = {}) {
  const resamples = Number.isFinite(options.resamples) ? options.resamples : 200
  const seed = Number.isFinite(options.seed) ? options.seed : 1
  if (!Array.isArray(samples) || samples.length < 2 || resamples <= 0) return null
  const random = mulberry32(seed)
  const totals = []
  for (let i = 0; i < resamples; i += 1) {
    const draw = []
    for (let j = 0; j < samples.length; j += 1) draw.push(samples[Math.floor(random() * samples.length)])
    const value = compute(draw)
    if (typeof value === 'number' && Number.isFinite(value)) totals.push(value)
  }
  if (totals.length < 20) return null
  totals.sort((a, b) => a - b)
  const at = (p) => totals[Math.min(totals.length - 1, Math.max(0, Math.round(p * (totals.length - 1))))]
  return {
    level: options.level ?? 0.95,
    low: Math.round(at(0.025) * 10) / 10,
    high: Math.round(at(0.975) * 10) / 10,
    resamples: totals.length,
  }
}

/**
 * Two skills whose intervals overlap are not ordered by the data. Reporting a
 * rank without saying that is how a "top fix" list turns into a wild goose
 * chase, so the report carries an explicit ranking note.
 */
export function rankingOf(entries) {
  const scored = (entries ?? []).filter(
    (entry) => entry && entry.score && entry.score.ci && typeof entry.score.total === 'number',
  )
  if (scored.length < 2) return { significant: true, note: null, ties: [] }
  const ties = []
  for (let i = 1; i < scored.length; i += 1) {
    const a = scored[i - 1]
    const b = scored[i]
    const overlap = a.score.ci.low <= b.score.ci.high && b.score.ci.low <= a.score.ci.high
    const close = Math.abs(a.score.total - b.score.total) <= 10
    if (overlap && close) ties.push({ a: a.skill, b: b.skill, aTotal: a.score.total, bTotal: b.score.total })
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

export const EDIT_DIMENSIONS = ['static', 'reliability', 'effectiveness', 'efficiency', 'mcp', 'lifecycle']

/**
 * RRSI's annealed edit budget: early iterations may carry a bundle of edits,
 * later ones shrink to a single attributable change. Here "iteration" is the
 * number of edits this skill already had accepted.
 */
export function annealedBudget(accepted, { max = 4, min = 1, horizon = 6 } = {}) {
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
export function explorationDirective(edits, { window = 2 } = {}) {
  const recent = (edits ?? []).filter((entry) => entry && typeof entry.dimension === 'string')
  if (recent.length < Math.max(2, window)) return null
  const tail = recent.slice(-Math.max(2, window))
  const stuck = tail[0].dimension
  if (!tail.every((entry) => entry.dimension === stuck)) return null
  const used = new Map()
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
export function normalizeWeights(input) {
  const raw = { ...DEFAULT_WEIGHTS, ...(input && typeof input === 'object' ? input : {}) }
  const cleaned = {}
  let sum = 0
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const value = Number(raw[key])
    const weight = Number.isFinite(value) && value > 0 ? value : 0
    cleaned[key] = weight
    sum += weight
  }
  if (!(sum > 0)) return { ...DEFAULT_WEIGHTS }
  const out = {}
  for (const key of Object.keys(cleaned)) out[key] = Math.round((cleaned[key] / sum) * 1000) / 1000
  return out
}

export function resolveThresholds(input) {
  const raw = { ...DEFAULT_THRESHOLDS, ...(input && typeof input === 'object' ? input : {}) }
  const pick = (key, fallback) => {
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

/**
 * Ties the append-only store to the live skill catalog.
 *
 * The store is the only durable state; everything here is derived on demand.
 * Static profiles are cached and invalidated on `skills/change`.
 */
export function createAnalyzer(ctx, config) {
  const store = new EventStore(resolveDataDir(config))
  const staticCache = new Map()
  let reportCache = null

  const invalidate = () => {
    staticCache.clear()
    reportCache = null
  }
  ctx.on('skills/change', invalidate)

  /**
   * Prefer the live catalog (fresh after an edit) and fall back to the static
   * profile captured at load time, which is the only path that knows the
   * agent-scoped layer the skill was resolved from.
   */
  async function catalogStatic(name) {
    if (staticCache.has(name)) return staticCache.get(name)
    let profile = null
    for (const options of [{}, { cwd: process.cwd() }]) {
      try {
        const summary = (await ctx.skills.list(options)).find((s) => s.name === name)
        if (!summary) continue
        const definition = await ctx.skills.get(name, options)
        profile = staticProfile(summary, definition)
        break
      } catch {
        profile = null
      }
    }
    staticCache.set(name, profile)
    return profile
  }

  function recordedStatic(records, name) {
    let latest = null
    for (const record of records) {
      if (!record || record.t !== 'static' || record.skill !== name || !record.static) continue
      if (!latest || (Number(record.at) || 0) >= (Number(latest.at) || 0)) latest = record
    }
    if (!latest || !latest.static || typeof latest.static !== 'object' || Array.isArray(latest.static)) return null
    // A hand-edited or older store may hold any shape here; normalise it so one
    // bad record cannot crash advice/report rendering for every skill.
    const text = (value) =>
      typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
    const num = (value, fallback = 0) => {
      const n = Number(value)
      return Number.isFinite(n) && n >= 0 ? n : fallback
    }
    const check = (entry) =>
      entry && typeof entry === 'object'
        ? { ...entry, fraction: num(entry.fraction), points: num(entry.points), weight: num(entry.weight) }
        : null
    const checks = (Array.isArray(latest.static.checks) ? latest.static.checks : []).map(check).filter(Boolean)
    const failedChecks = (
      Array.isArray(latest.static.failedChecks) ? latest.static.failedChecks : checks.filter((c) => c.fraction < 1)
    )
      .map(check)
      .filter(Boolean)
    const integrity =
      latest.static.integrity && typeof latest.static.integrity === 'object'
        ? {
            checked: num(latest.static.integrity.checked),
            missing: Array.isArray(latest.static.integrity.missing)
              ? latest.static.integrity.missing.filter((item) => typeof item === 'string')
              : [],
          }
        : null
    return {
      name: text(latest.static.name),
      description: text(latest.static.description),
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

  async function resolveStatic(name, records = []) {
    const profile = (await catalogStatic(name)) ?? recordedStatic(records, name)
    if (!profile || typeof profile !== 'object' || !('content' in profile)) return profile
    // old static records embedded the whole body; never surface it again
    const { content: _body, ...rest } = profile
    return rest
  }

  async function build(options = {}) {
    // The panel polls and each turn strip asks once; reuse the last report while
    // the store has not changed (EventStore.version) and settings are unchanged.
    const stamp = await store.stamp()
    if (!options.skill && reportCache && reportCache.stamp === stamp && Date.now() - reportCache.at < 2000) {
      return reportCache.report
    }
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
      const scoreSamples = (samples) =>
        scoreSkill({
          stats: aggregate(samples, { cacheReadWeight }),
          static: sp,
          weights,
          thresholds,
          minSamples,
          tokenBudgetPerLoad,
        })
      const score = scoreSamples(group.samples)
      score.ci = bootstrapCI(group.samples, (draw) => scoreSamples(draw).total, {
        resamples: config.ciResamples ?? 200,
        seed: hashSeed(group.skill),
      })
      // Last few per-load scores for the panel sparkline. One sample is scored
      // with the same options as the aggregate; capped so the payload stays small.
      const trend = group.samples
        .slice(-12)
        .map((sample) => {
          const point = scoreSamples([sample])
          return Number.isFinite(point.total)
            ? {
                at: Number.isFinite(Number(sample.at)) ? Number(sample.at) : null,
                total: Math.round(point.total * 10) / 10,
              }
            : null
        })
        .filter(Boolean)
      const windows = group.samples.map((sample) => sample.window).filter(Boolean)
      const advice = buildAdvice({
        stats,
        static: sp,
        score,
        minSamples,
        windows,
        gating: config.adviceNoiseFloor !== false,
        tokenBudgetPerLoad: config.tokenBudgetPerLoad ?? 20000,
        pruneMinLoads: config.pruneMinLoads ?? 6,
        pruneMaxScore: config.pruneMaxScore ?? 60,
      })
      const skillEdits = editsChronological.filter((record) => record.skill === group.skill)
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
        advice,
        topAdvice: topAdvice(advice, Math.min(config.maxAdvice ?? 3, adviceBudget)),
      })
    }
    entries.sort((a, b) => a.score.total - b.score.total)
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
    const report = {
      generatedAt: new Date().toISOString(),
      dataDir: store.dir,
      mcpServers: mcpRows,
      mcpAdvice,
      // The alert line the board draws on the latency chart must be the same
      // threshold the advice uses, otherwise the chart celebrates a server the
      // advice calls slow (or the reverse).
      mcp: {
        p95Ms: typeof config.mcpP95Ms === 'number' ? config.mcpP95Ms : null,
        errorRatePercent: typeof config.mcpErrorRatePercent === 'number' ? config.mcpErrorRatePercent : null,
      },
      runs: runsOf(records, skillScores, thresholds, minSamples, config.ciResamples ?? 200),
      turnLoads: turnLoads(records),
      steps: stepLog.slice(-400),
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
        weightsPercent: Object.fromEntries(
          Object.entries(weights).map(([key, value]) => [key, Math.round(value * 100)]),
        ),
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
    if (!options.skill) reportCache = { stamp, at: Date.now(), report }
    return report
  }

  /** One row per MCP server, merged across every skill window. */
  function mcpServers(entries) {
    const merged = new Map()
    for (const entry of entries) {
      for (const [server, bucket] of Object.entries(entry.stats.mcp ?? {})) {
        const row = merged.get(server) ?? {
          server,
          calls: 0,
          errors: 0,
          ms: 0,
          samples: [],
          tools: Object.create(null),
        }
        row.calls += Number(bucket.calls) || 0
        row.errors += Number(bucket.errors) || 0
        row.ms += Number(bucket.ms) || 0
        if (Array.isArray(bucket.samples)) {
          for (const sample of bucket.samples) {
            if (typeof sample === 'number' && row.samples.length < 400) row.samples.push(sample)
          }
        }
        for (const [tool, stats] of Object.entries(bucket.tools ?? {})) {
          const t = Object.hasOwn(row.tools, tool) ? row.tools[tool] : { calls: 0, errors: 0, ms: 0, samples: [] }
          t.calls += Number(stats.calls) || 0
          t.errors += Number(stats.errors) || 0
          t.ms = (t.ms ?? 0) + (Number(stats.ms) || 0)
          if (Array.isArray(stats.samples)) {
            for (const sample of stats.samples) {
              if (typeof sample === 'number' && t.samples.length < 60) t.samples.push(sample)
            }
          }
          row.tools[tool] = t
        }
        merged.set(server, row)
      }
    }
    const rows = [...merged.values()].map((row) => {
      const errorRate = row.calls > 0 ? row.errors / row.calls : 0
      const avgMs = row.calls > 0 ? row.ms / row.calls : null
      const samples = Array.isArray(row.samples) ? [...row.samples].sort((a, b) => a - b) : []
      const percentile = (p) => {
        if (samples.length === 0) return null
        const index = Math.min(samples.length - 1, Math.max(0, Math.round((p / 100) * (samples.length - 1))))
        return samples[index]
      }
      let health = 100 - 70 * errorRate
      if (avgMs !== null && avgMs > 1500) health -= Math.min(20, (avgMs - 1500) / 100)
      health = Math.max(0, Math.min(100, health))
      const toolPercentile = (samples, p) => {
        if (!Array.isArray(samples) || samples.length === 0) return null
        const sorted = [...samples].sort((a, b) => a - b)
        const index = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))
        return sorted[index]
      }
      const tools = Object.entries(row.tools)
        .map(([tool, stats]) => ({
          tool,
          calls: stats.calls,
          errors: stats.errors,
          errorRate: stats.calls > 0 ? stats.errors / stats.calls : 0,
          avgMs: stats.calls > 0 && stats.ms ? Math.round(stats.ms / stats.calls) : null,
          p50Ms: toolPercentile(stats.samples, 50),
          p95Ms: toolPercentile(stats.samples, 95),
        }))
        .sort((a, b) => b.calls - a.calls)
      return {
        server: row.server,
        calls: row.calls,
        errors: row.errors,
        errorRate,
        avgMs: avgMs === null ? null : Math.round(avgMs),
        p50Ms: percentile(50),
        p95Ms: percentile(95),
        samples: samples.length,
        health: Math.round(health * 10) / 10,
        grade: gradeOf(health),
        tools,
      }
    })
    rows.sort((a, b) => a.health - b.health)
    return rows
  }

  function clamp01(value) {
    return Math.max(0, Math.min(100, value))
  }

  /**
   * Score one run (session) with its own dimensions: the quality of the skills
   * it actually used, how stable the execution was, whether the user accepted
   * the result, and what it cost. Weights differ from the skill score because a
   * run is a sample of work, not an artifact.
   */
  function scoreRun(run, skillScores, thresholds, minSamples) {
    const skillValues = run.skills.map((name) => skillScores.get(name)).filter((value) => typeof value === 'number')
    const quality = skillValues.length > 0 ? skillValues.reduce((a, b) => a + b, 0) / skillValues.length : null
    const windows = run.closed
    const correctionRate = windows > 0 ? run.corrections / windows : null
    const errRate = run.toolCalls > 0 ? run.errors / run.toolCalls : null
    const loopRate = windows > 0 ? Math.min(1, run.loopErrors / windows) : null
    const outcome = correctionRate === null ? null : clamp01(100 - 45 * correctionRate)
    const stability =
      errRate === null && loopRate === null ? null : clamp01(100 - 60 * (errRate ?? 0) - 40 * (loopRate ?? 0))
    const callsPerLoad = run.loads > 0 ? run.toolCalls / run.loads : null
    // A load with no execution behind it is cheap but empty: judge it down
    // instead of rewarding "nothing happened" with full efficiency.
    let efficiency = callsPerLoad === null ? null : clamp01(100 - Math.max(0, callsPerLoad - 8) * 6)
    if (efficiency !== null && callsPerLoad < 1) efficiency = Math.min(efficiency, 45)
    const dims = { quality, stability, outcome, efficiency }
    const weights = { quality: 0.4, stability: 0.3, outcome: 0.2, efficiency: 0.1 }
    let weighted = 0
    let weightSum = 0
    for (const [key, value] of Object.entries(dims)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue
      weighted += value * weights[key]
      weightSum += weights[key]
    }
    const total = weightSum > 0 ? Math.round((weighted / weightSum) * 10) / 10 : null
    return {
      total,
      grade: gradeOf(total, thresholds),
      confidence:
        run.loads === 0 ? 'none' : run.loads < minSamples ? 'low' : run.loads < minSamples * 3 ? 'medium' : 'high',
      provisional: run.loads < minSamples,
      dimensions: dims,
    }
  }

  /**
   * Skill loads grouped by the loop turn that produced them, so a client surface
   * can render the result under the exact completed turn instead of guessing.
   */
  function turnLoads(records) {
    const byTurn = new Map()
    for (const record of records) {
      if (!record || record.t !== 'skill' || typeof record.sessionId !== 'string') continue
      if (typeof record.turn !== 'number' || typeof record.skill !== 'string') continue
      const key = `${record.sessionId}#${record.turn}`
      const entry = byTurn.get(key) ?? {
        sessionId: record.sessionId,
        turn: record.turn,
        skills: [],
        firstAt: record.at,
        lastAt: record.at,
      }
      if (!entry.skills.includes(record.skill)) entry.skills.push(record.skill)
      entry.lastAt = Math.max(entry.lastAt ?? record.at, record.at)
      byTurn.set(key, entry)
    }
    return [...byTurn.values()].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)).slice(0, 100)
  }

  /** One row per session: what that run actually did, and how it went. */
  function runsOf(records, skillScores, thresholds, minSamples, ciResamples) {
    const bySession = new Map()
    const windowsBySession = new Map()
    const touch = (sessionId) => {
      if (typeof sessionId !== 'string' || sessionId.length === 0) return null
      let run = bySession.get(sessionId)
      if (!run) {
        run = {
          sessionId,
          firstAt: null,
          lastAt: null,
          loads: 0,
          closed: 0,
          toolCalls: 0,
          errors: 0,
          corrections: 0,
          mcpCalls: 0,
          mcpErrors: 0,
          tokens: 0,
          loopErrors: 0,
          skills: [],
          score: null,
        }
        bySession.set(sessionId, run)
      }
      return run
    }
    for (const record of records) {
      if (!record || typeof record !== 'object') continue
      if (typeof record.sessionId !== 'string' || record.sessionId.length === 0) continue
      if (record.t === 'skill') {
        const run = touch(record.sessionId)
        if (!run) continue
        run.loads += 1
        if (record.skill && !run.skills.includes(record.skill)) run.skills.push(record.skill)
        run.firstAt = run.firstAt === null ? record.at : Math.min(run.firstAt, record.at)
        run.lastAt = run.lastAt === null ? record.at : Math.max(run.lastAt, record.at)
      } else if (record.t === 'window') {
        touch(record.sessionId)
        const bucket = windowsBySession.get(record.sessionId) ?? new Map()
        // One window is persisted at turn end and again when it closes: keep the
        // latest record per windowId so run counters and a bootstrap draw count
        // it once.
        bucket.set(record.windowId ?? `${record.at}:${bucket.size}`, record)
        windowsBySession.set(record.sessionId, bucket)
      }
    }
    // Sum the deduplicated, latest-per-window records, not every cumulative
    // snapshot the recorder wrote.
    for (const [sessionId, run] of bySession) {
      const windows = [...(windowsBySession.get(sessionId) ?? new Map()).values()]
      run.closed = windows.length
      for (const window of windows) {
        run.toolCalls += Number(window.toolCalls) || 0
        run.errors += Number(window.errors) || 0
        run.loopErrors += Number(window.loopErrors) || 0
        run.corrections += Array.isArray(window.corrections) ? window.corrections.length : 0
        const windowTokens = window.tokens
        if (windowTokens && typeof windowTokens === 'object') {
          run.tokens += (Number(windowTokens.input) || 0) + (Number(windowTokens.output) || 0)
        }
        for (const bucket of Object.values(window.mcp ?? {})) {
          run.mcpCalls += Number(bucket?.calls) || 0
          run.mcpErrors += Number(bucket?.errors) || 0
        }
        if (typeof window.at === 'number') {
          run.lastAt = run.lastAt === null ? window.at : Math.max(run.lastAt, window.at)
        }
      }
    }
    const runs = [...bySession.values()].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)).slice(0, 20)
    for (const run of runs) {
      run.score = scoreRun(run, skillScores, thresholds, minSamples)
      const windows = [...(windowsBySession.get(run.sessionId) ?? new Map()).values()]
      run.score.ci = bootstrapCI(
        windows,
        (draw) => {
          const summed = {
            ...run,
            closed: draw.length,
            toolCalls: draw.reduce((a, w) => a + (w.toolCalls ?? 0), 0),
            errors: draw.reduce((a, w) => a + (w.errors ?? 0), 0),
            loopErrors: draw.reduce((a, w) => a + (w.loopErrors ?? 0), 0),
            corrections: draw.reduce((a, w) => a + (Array.isArray(w.corrections) ? w.corrections.length : 0), 0),
          }
          return scoreRun(summed, skillScores, thresholds, minSamples).total
        },
        { resamples: ciResamples ?? 0, seed: hashSeed(run.sessionId) },
      )
    }
    return runs
  }

  async function buildOne(name) {
    const report = await build({ skill: name })
    return report.skills[0] ?? null
  }

  return { build, buildOne, store, invalidate, resolveStatic }
}
