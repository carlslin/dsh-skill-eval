/**
 * Run-level and MCP-server aggregation.
 *
 * Extracted from report.ts's createAnalyzer closure: these are pure functions
 * over stored records, unit-testable without a host. report.ts keeps thin
 * re-exports for compatibility.
 */
import { gradeOf } from './score.ts'
import { hashSeed } from './random.ts'
import { bootstrapCI, type Interval95 } from './stats.ts'
import type { Stats } from './score.ts'
import type { StoredRecord, Thresholds } from './types.ts'

export interface Run {
  sessionId: string
  firstAt: number | null
  lastAt: number | null
  loads: number
  closed: number
  toolCalls: number
  errors: number
  corrections: number
  mcpCalls: number
  mcpErrors: number
  tokens: number
  loopErrors: number
  skills: string[]
  score: RunScore | null
}

export interface RunScore {
  total: number | null
  grade: string
  confidence: string
  provisional: boolean
  dimensions: Record<string, number | null>
  ci: Interval95 | null
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/**
 * Score one run (session) with its own dimensions: the quality of the skills
 * it actually used, how stable the execution was, whether the user accepted
 * the result, and what it cost. Weights differ from the skill score because a
 * run is a sample of work, not an artifact.
 */
export function scoreRun(
  run: Run,
  skillScores: Map<string, number | null>,
  thresholds: Thresholds,
  minSamples: number,
) {
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
  if (efficiency !== null && callsPerLoad !== null && callsPerLoad < 1) efficiency = Math.min(efficiency, 45)
  const dims = { quality, stability, outcome, efficiency }
  const weights = { quality: 0.4, stability: 0.3, outcome: 0.2, efficiency: 0.1 }
  let weighted = 0
  let weightSum = 0
  for (const [key, value] of Object.entries(dims) as Array<[keyof typeof weights, number | null]>) {
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
export function turnLoads(records: readonly StoredRecord[]) {
  const byTurn = new Map<
    string,
    { sessionId: string; turn: number; skills: string[]; firstAt: number; lastAt: number }
  >()
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

/** One row per MCP server, merged across every skill window. */
export function mcpServers(entries: ReadonlyArray<{ stats: { mcp?: Stats['mcp'] } }>) {
  const merged = new Map<
    string,
    {
      server: string
      calls: number
      errors: number
      ms: number
      samples: number[]
      tools: Record<string, { calls: number; errors: number; ms: number; samples: number[] }>
    }
  >()
  for (const entry of entries) {
    for (const [server, bucket] of Object.entries(entry.stats.mcp ?? {})) {
      const row = merged.get(server) ?? {
        server,
        calls: 0,
        errors: 0,
        ms: 0,
        samples: [] as number[],
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
        if (!stats || typeof stats !== 'object' || Array.isArray(stats)) continue
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
    const percentile = (p: number) => {
      if (samples.length === 0) return null
      const index = Math.min(samples.length - 1, Math.max(0, Math.round((p / 100) * (samples.length - 1))))
      return samples[index]
    }
    let health = 100 - 70 * errorRate
    if (avgMs !== null && avgMs > 1500) health -= Math.min(20, (avgMs - 1500) / 100)
    health = Math.max(0, Math.min(100, health))
    const toolPercentile = (samples: number[], p: number) => {
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

/** One row per session: what that run actually did, and how it went. */
export function runsOf(
  records: readonly StoredRecord[],
  skillScores: Map<string, number | null>,
  thresholds: Thresholds,
  minSamples: number,
  ciResamples: number,
) {
  const bySession = new Map<string, Run>()
  const windowsBySession = new Map<string, Map<string, StoredRecord>>()
  const touch = (sessionId: unknown) => {
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
      const bucket = windowsBySession.get(record.sessionId) ?? new Map<string, StoredRecord>()
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
    const windows = [...(windowsBySession.get(sessionId) ?? new Map<string, StoredRecord>()).values()]
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
    const score: RunScore = { ...scoreRun(run, skillScores, thresholds, minSamples), ci: null }
    run.score = score
    const windows = [...(windowsBySession.get(run.sessionId) ?? new Map<string, StoredRecord>()).values()]
    score.ci = bootstrapCI(
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
