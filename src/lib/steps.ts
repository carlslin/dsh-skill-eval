/**
 * Per-step loop telemetry: one record per agent loop step, scored so the panel
 * can show how a turn actually went instead of only its final aggregate.
 *
 * Records are written by the recorder as `{t:'step', sessionId, turn, step,
 * toolCalls, errors, loopErrors, tokens, skills, ...}`. This module sanitises
 * them, derives a 0-100 step score and groups them by turn for display.
 */
import { DEFAULT_THRESHOLDS, gradeOf } from './score.ts'
import type { StoredRecord, Thresholds } from './types.ts'

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const round = (value: number) => Math.round(value * 10) / 10
const count = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}
const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** Score one loop step: errors and loop failures dominate, call volume is a hint. */
export function scoreStep(
  step: { toolCalls?: unknown; errors?: unknown; loopErrors?: unknown } | null | undefined,
  thresholds: Partial<Thresholds> = DEFAULT_THRESHOLDS,
) {
  if (!step || typeof step !== 'object') return null
  const toolCalls = count(step.toolCalls)
  const errors = count(step.errors)
  const loopErrors = count(step.loopErrors)
  const penalties: Array<{ id: string; penalty: number }> = []
  let score = 100
  if (errors > 0) {
    const penalty = Math.min(50, errors * 20)
    score -= penalty
    penalties.push({ id: 'tool-errors', penalty })
  }
  if (loopErrors > 0) {
    const penalty = Math.min(60, loopErrors * 35)
    score -= penalty
    penalties.push({ id: 'loop-errors', penalty })
  }
  if (toolCalls > 6) {
    const penalty = Math.min(18, Math.round((toolCalls - 6) * 3))
    score -= penalty
    penalties.push({ id: 'call-volume', penalty })
  }
  const total = round(clamp(score, 0, 100))
  return { total, grade: gradeOf(total, thresholds), penalties }
}

export interface Step {
  at: number | null
  sessionId: string
  turn: number | null
  step: number | null
  durationMs: number
  toolCalls: number
  errors: number
  mcpCalls: number
  mcpErrors: number
  loopErrors: number
  skills: string[]
  tokens: { input: number; output: number; cacheRead: number; calls: number }
  errorNames: string[]
  closeReason: string | null
  score: NonNullable<ReturnType<typeof scoreStep>>
}

/** Sanitise + score the raw `step` records, oldest first. */
export function buildSteps(
  records: unknown,
  { thresholds = DEFAULT_THRESHOLDS, limit = 400 }: { thresholds?: Partial<Thresholds>; limit?: number } = {},
) {
  const steps: Step[] = []
  for (const record of (Array.isArray(records) ? records : []) as Array<StoredRecord | null>) {
    if (!record || record.t !== 'step' || typeof record.sessionId !== 'string') continue
    const scored = scoreStep(record, thresholds)
    if (!scored) continue
    steps.push({
      at: Number.isFinite(Number(record.at)) ? Number(record.at) : null,
      sessionId: record.sessionId,
      turn: Number.isFinite(Number(record.turn)) ? Number(record.turn) : null,
      step: Number.isFinite(Number(record.step)) ? Number(record.step) : null,
      durationMs: count(record.durationMs),
      toolCalls: count(record.toolCalls),
      errors: count(record.errors),
      mcpCalls: count(record.mcpCalls),
      mcpErrors: count(record.mcpErrors),
      loopErrors: count(record.loopErrors),
      skills: Array.isArray(record.skills) ? record.skills.filter((name: unknown) => typeof name === 'string') : [],
      tokens: {
        input: count(record.tokens?.input),
        output: count(record.tokens?.output),
        cacheRead: count(record.tokens?.cacheRead),
        calls: count(record.tokens?.calls),
      },
      errorNames: Array.isArray(record.errorNames)
        ? record.errorNames.filter((name: unknown) => typeof name === 'string')
        : [],
      closeReason: text(record.closeReason) || null,
      score: scored,
    })
  }
  steps.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  return limit > 0 ? steps.slice(-limit) : steps
}

/** Group steps into turns and add turn-level averages plus overall comparison data. */
export function summarizeSteps(steps: readonly Step[], { limit = 12 }: { limit?: number } = {}) {
  const byTurn = new Map<
    string,
    {
      sessionId: string
      turn: number | null
      firstAt: number | null
      lastAt: number | null
      steps: Step[]
      skills: string[]
    }
  >()
  for (const step of Array.isArray(steps) ? steps : []) {
    if (!step) continue
    const key = `${step.sessionId}#${step.turn ?? '?'}`
    let turn = byTurn.get(key)
    if (!turn) {
      turn = {
        sessionId: step.sessionId,
        turn: step.turn,
        firstAt: step.at,
        lastAt: step.at,
        steps: [],
        skills: [],
      }
      byTurn.set(key, turn)
    }
    turn.steps.push(step)
    turn.lastAt = Math.max(turn.lastAt ?? 0, step.at ?? 0)
    for (const skill of step.skills ?? []) if (!turn.skills.includes(skill)) turn.skills.push(skill)
  }
  const turns = [...byTurn.values()]
    .map((turn) => {
      const scores = turn.steps.map((step) => step.score?.total).filter((value) => Number.isFinite(value))
      const average = scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null
      return {
        ...turn,
        steps: turn.steps.sort((a, b) => (a.step ?? 0) - (b.step ?? 0)),
        average: average === null ? null : round(average),
        best: scores.length > 0 ? Math.max(...scores) : null,
        worst: scores.length > 0 ? Math.min(...scores) : null,
      }
    })
    .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
  const recent = turns.slice(0, limit)
  const latest = recent.length > 0 ? recent[0] : null
  const previous = recent.length > 1 ? recent[1] : null
  const delta =
    latest && previous && latest.average !== null && previous.average !== null
      ? round(latest.average - previous.average)
      : null
  const allScores = steps.map((step) => step.score?.total).filter((value) => Number.isFinite(value))
  const overall = {
    steps: allScores.length,
    turns: turns.length,
    average: allScores.length > 0 ? round(allScores.reduce((sum, value) => sum + value, 0) / allScores.length) : null,
    latestAverage: latest?.average ?? null,
    previousAverage: previous?.average ?? null,
    delta,
  }
  return { turns: recent, totalTurns: turns.length, overall }
}

/**
 * Steps that mention a skill, for the per-skill drill-down. `skill` empty means
 * all steps; the caller can keep its own filter chip in sync with this list.
 */
export function stepsForSkill(
  steps: readonly Step[] | null | undefined,
  skill: string | null | undefined,
): readonly Step[] {
  if (!skill) return Array.isArray(steps) ? steps : []
  return (Array.isArray(steps) ? steps : []).filter((step) => (step.skills ?? []).includes(skill))
}
