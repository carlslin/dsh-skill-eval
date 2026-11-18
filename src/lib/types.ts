/**
 * Shared shapes. Records come back from an append-only JSONL file that older
 * versions also wrote, so persisted fields are optional and still validated
 * at runtime; the types document the current writer, not a guarantee.
 */

/**
 * DSH ships no type declarations, so host objects (ctx, agent, tool payloads,
 * route requests) stay untyped at this one seam.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Host = any

export type Severity = 'critical' | 'warning' | 'info'

export interface Advice {
  id: string
  severity: Severity
  dimension?: string
  title: string
  evidence: string
  fix: string
  titleZh?: string
  fixZh?: string
  server?: string
  tool?: string
  skill?: string
  [extra: string]: unknown
}

export interface Tokens {
  input: number
  output: number
  cacheRead: number
  calls: number
}

export interface McpToolBucket {
  calls: number
  errors: number
  ms?: number
  samples: number[]
}

export interface McpBucket {
  calls: number
  errors: number
  ms: number
  samples?: number[]
  windows?: number
  tools: Record<string, McpToolBucket>
}

/** One observation window after a skill load, as persisted (`t: 'window'`). */
export interface WindowRecord {
  windowId?: string
  sessionId?: string
  skill?: string
  toolCalls?: number
  errors?: number
  errorNames?: string[]
  loopErrors?: number
  llmRetries?: number
  lastLoopError?: string | null
  mcp?: Record<string, McpBucket>
  tokens?: Partial<Tokens> | null
  corrections?: string[]
  otherSkills?: string[]
  origin?: string | null
  step?: number
  turnEnded?: boolean
  truncated?: boolean
  closeReason?: string | null
  at?: number
}

/** One skill load joined with its window (input to `aggregate`). */
export interface Sample {
  ok?: boolean
  loadMs?: number | null
  error?: string | null
  window?: WindowRecord | null
  [extra: string]: unknown
}

export interface Interval {
  mean: number
  low: number
  high: number
  resamples: number
  windows: number
  calls?: number
}

export type Dimension = 'static' | 'reliability' | 'effectiveness' | 'efficiency'
export type Weights = Record<Dimension, number>
export interface Thresholds {
  pass: number
  good: number
  excellent: number
}

/** Any line of events.jsonl, keyed by `t`. */
export interface StoredRecord extends WindowRecord {
  t?: string
  v?: number
  at: number
  callId?: string
  ok?: boolean
  loadMs?: number
  error?: string
  via?: string
  turn?: number | null
  verdict?: string
  dimension?: string
  hypothesis?: string
  [extra: string]: unknown
}

/** Parsed JSON from outside the process (HTTP bodies, files), checked field by field at runtime. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any
