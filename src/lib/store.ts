import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { McpBucket, StoredRecord, Tokens } from './types.ts'

function expandHome(p: unknown): string | null {
  if (typeof p !== 'string' || p.length === 0) return null
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return path.resolve(p)
}

/** Keep this much of events.jsonl before dropping its oldest half. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

/**
 * Create the telemetry directory owner-only. New directories are created
 * 0700; an existing directory keeps whatever mode the user gave it, and the
 * files inside are written 0600 either way.
 */
export async function ensurePrivateDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
}

/** Cheap guard before paying for a parse: is this line an `edit` record? */
function isEditLine(line: string): boolean {
  if (!line.includes('"edit"')) return false
  try {
    return JSON.parse(line).t === 'edit'
  } catch {
    return false
  }
}

/** Write-and-rename atomically; a leftover .tmp keeps its old mode, so recreate it. */
export async function writePrivateAtomic(file: string, content: string): Promise<void> {
  const temp = `${file}.tmp`
  await fs.rm(temp, { force: true })
  await fs.writeFile(temp, content, { encoding: 'utf8', mode: 0o600 })
  await fs.rename(temp, file)
}

const LOCK_STALE_MS = 10_000
const LOCK_TIMEOUT_MS = 15_000

/**
 * Serialize appends across processes: two hosts can share one data dir, and a
 * write between another process's read and rename lands in the replaced inode
 * and is silently lost. The lock file is `events.jsonl.lock`; a lock older
 * than LOCK_STALE_MS is treated as a crash leftover and removed.
 */
function errorCode(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
}

async function withFileLock<T>(lockFile: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now()
  for (;;) {
    try {
      await (await fs.open(lockFile, 'wx', 0o600)).close()
      break
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      const info = await fs.stat(lockFile).catch(() => null)
      if (info && Date.now() - info.mtimeMs > LOCK_STALE_MS) {
        // Only one waiter may take a dead lock over: rename is atomic, so a
        // loser gets ENOENT instead of deleting the winner's fresh lock (two
        // rm calls after a crash could otherwise hand out two owners at once).
        const stolen = `${lockFile}.stale.${process.pid}`
        try {
          await fs.rename(lockFile, stolen)
          await fs.rm(stolen, { force: true })
        } catch (stealError) {
          if (errorCode(stealError) !== 'ENOENT') throw stealError
        }
        continue
      }
      if (Date.now() - started > LOCK_TIMEOUT_MS)
        throw new Error('events.jsonl is locked by another process', { cause: error })
      await new Promise((resolve) => setTimeout(resolve, 15))
    }
  }
  try {
    return await fn()
  } finally {
    await fs.rm(lockFile, { force: true })
  }
}

/**
 * Drop the oldest records once the file outgrows maxBytes. The cut lands on a
 * line boundary so a reader never sees half a record. `edit` records share the
 * same byte budget but are kept first (up to a quarter of the cap): they are
 * the audit ledger the review budget, board ledger and impact view all read.
 * The trimmed file is at most half the cap, so the next appends do not rotate
 * right away. Note: a single record larger than the cap is still kept, so a
 * poison record retriggers rotation on every append — keep per-record caps
 * (samples/corrections truncation) tight upstream.
 */
async function rotateFile(file: string, maxBytes: number): Promise<void> {
  let raw: string
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    throw error
  }
  const keep = Math.max(1, Math.floor(maxBytes / 2))
  const editBudget = Math.floor(maxBytes / 4)
  const lines = raw.split('\n').filter((line) => line.length > 0)
  const chosen = new Set<number>()
  let bytes = 0
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!isEditLine(lines[i])) continue
    const size = Buffer.byteLength(lines[i]) + 1
    if (bytes + size > editBudget) break
    chosen.add(i)
    bytes += size
  }
  let cut = lines.length
  let suffix = 0
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (chosen.has(i)) continue
    const size = Buffer.byteLength(lines[i]) + 1
    if (suffix > 0 && bytes + size > keep) break
    cut = i
    suffix += 1
    bytes += size
  }
  const kept = lines.filter((_, i) => chosen.has(i) || i >= cut)
  await writePrivateAtomic(file, `${kept.join('\n')}\n`)
}

/**
 * Where telemetry lives. Kept OUTSIDE the session log on purpose: the session
 * log is the harness's source of truth and plugins must not append foreign
 * event types to it. Explicit paths must be absolute and may not be the
 * filesystem root; operator config is trusted, but a typo pointing at `/`
 * must fail loudly instead of chmod/chown-ing the machine.
 */
export function resolveDataDir(config: { dataDir?: unknown } = {}): string {
  const explicit = expandHome(config.dataDir) || expandHome(process.env.DSH_SKILL_EVAL_DIR)
  if (explicit) {
    if (explicit === '/' || explicit === '') throw new Error('skill-eval dataDir must not be the filesystem root')
    return explicit
  }
  const home = expandHome(process.env.DSH_HOME) || path.join(os.homedir(), '.dsh')
  const profile = process.env.DSH_PROFILE || 'default'
  return path.join(home, 'skill-eval', profile)
}

/**
 * Append-only JSONL store. Writes are serialized through one promise chain so
 * concurrent tool results cannot interleave partial lines.
 */
export class EventStore {
  dir: string
  file: string
  queue: Promise<void>
  pending: number
  failed: string | null
  maxBytes: number
  privateFile: boolean
  version: number
  onError?: (message: string) => void

  constructor(dir: string, options: { maxBytes?: unknown } = {}) {
    this.dir = dir
    this.file = path.join(dir, 'events.jsonl')
    this.queue = Promise.resolve()
    this.pending = 0
    this.failed = null
    const cap = Number(options.maxBytes)
    this.maxBytes = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : DEFAULT_MAX_BYTES
    this.privateFile = false
    // Bumped on every successful append; the analyzer uses it to invalidate a
    // cached report without re-reading the whole store on every request.
    this.version = 0
    this.rotating = null
  }

  private rotating: Promise<boolean> | null

  /**
   * Bound the file outside the append lock so a slow multi-MB rewrite never
   * blocks the next append's critical section. Concurrent overflows coalesce
   * onto one rotation; the size is re-checked under the rotation lock, so a
   * file that shrunk (or vanished) concurrently is left alone.
   */
  private coalescedRotate(): Promise<boolean> {
    const current = this.rotating
    if (current) return current
    const file = this.file
    const maxBytes = this.maxBytes
    const pending: Promise<boolean> = withFileLock(`${file}.lock`, async () => {
      let size: number
      try {
        size = (await fs.stat(file)).size
      } catch {
        return
      }
      if (size > maxBytes) await rotateFile(file, maxBytes)
    }).then(
      () => {
        if (this.rotating === pending) this.rotating = null
        return true
      },
      (error: unknown) => {
        this.reportFailure(error)
        if (this.rotating === pending) this.rotating = null
        return false
      },
    )
    this.rotating = pending
    return pending
  }

  private reportFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    const first = this.failed === null
    const changed = this.failed !== message
    this.failed = message
    // Report the first failure and every *new* failure mode; identical
    // repeats stay silent so a full disk does not spam the host log.
    if ((first || changed) && typeof this.onError === 'function') {
      try {
        this.onError(message)
      } catch {
        // the logger itself must never break recording
      }
    }
  }

  append(record: unknown): Promise<void> {
    let line: string | undefined
    try {
      line = JSON.stringify(record)
    } catch {
      return Promise.resolve()
    }
    if (typeof line !== 'string') return Promise.resolve()
    this.pending += 1
    this.queue = this.queue
      .then(async () => {
        await ensurePrivateDir(this.dir)
        // Tighten once per process: an existing file may predate the owner-only
        // mode, and appendFile's mode only applies at creation.
        if (!this.privateFile) {
          this.privateFile = true
          try {
            await fs.chmod(this.file, 0o600)
          } catch {
            // missing or foreign-owned file: the append below creates it 0600
          }
        }
        // The torn-tail repair and the append itself are one critical
        // section: a writer in another process must not interleave. Rotation
        // runs after the append under its own coalesced lock (see below), so
        // a slow multi-MB rewrite never blocks the next append.
        await withFileLock(`${this.file}.lock`, async () => {
          // A crash can leave a record without its trailing newline. Appending
          // on top of that fragment would glue two records into one unparseable
          // line and silently lose the new record too, so close the tail first.
          try {
            const info = await fs.stat(this.file)
            if (info.size > 0) {
              const handle = await fs.open(this.file, 'r')
              try {
                const last = Buffer.alloc(1)
                await handle.read(last, 0, 1, info.size - 1)
                if (last[0] !== 0x0a) await fs.appendFile(this.file, '\n', { encoding: 'utf8', mode: 0o600 })
              } finally {
                await handle.close()
              }
            }
          } catch (error) {
            if (errorCode(error) !== 'ENOENT') throw error
          }
          await fs.appendFile(this.file, line + '\n', { encoding: 'utf8', mode: 0o600 })
        })
        const rotated = await this.coalescedRotate()
        // The record is already on disk; only clear a prior failure when
        // rotation also succeeded. A failed rotate must not wipe onError.
        if (rotated) this.failed = null
        this.version += 1
      })
      .catch((error) => {
        this.reportFailure(error)
      })
      .finally(() => {
        this.pending = Math.max(0, this.pending - 1)
      })
    return this.queue
  }

  /** Read every parseable record; malformed lines from a crash are skipped. */
  async readAll(): Promise<StoredRecord[]> {
    let raw: string
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return []
      throw error
    }
    const out: StoredRecord[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length === 0) continue
      try {
        out.push(JSON.parse(trimmed))
      } catch {
        // torn write — ignore
      }
    }
    return out
  }

  async size(): Promise<number> {
    try {
      const st = await fs.stat(this.file)
      return st.size
    } catch {
      return 0
    }
  }

  /** Cheap identity of the current file contents for report caching. */
  async stamp(): Promise<string> {
    try {
      const st = await fs.stat(this.file)
      return `${st.mtimeMs}:${st.size}`
    } catch {
      return 'missing'
    }
  }
}

function finiteNumbers(value: unknown, limit: number): number[] {
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item) && out.length < limit) out.push(item)
  }
  return out
}

type Untrusted = Record<string, unknown>

/**
 * Normalise a persisted MCP bucket tree. A hand-edited or corrupted window
 * record (a null tool entry, a string where an object belongs) must never be
 * able to crash the report surfaces, so every level is type-checked here.
 */
export function sanitizeMcp(value: unknown): Record<string, McpBucket> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, McpBucket> = Object.create(null)
  for (const [server, bucket] of Object.entries(value as Record<string, Untrusted | null>)) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue
    const tools: McpBucket['tools'] = Object.create(null)
    for (const [tool, stats] of Object.entries((bucket.tools ?? {}) as Record<string, Untrusted | null>)) {
      if (!stats || typeof stats !== 'object' || Array.isArray(stats)) continue
      tools[tool] = {
        calls: Number(stats.calls) || 0,
        errors: Number(stats.errors) || 0,
        ms: Number(stats.ms) || 0,
        samples: finiteNumbers(stats.samples, 20),
      }
    }
    out[server] = {
      calls: Number(bucket.calls) || 0,
      errors: Number(bucket.errors) || 0,
      ms: Number(bucket.ms) || 0,
      samples: finiteNumbers(bucket.samples, 40),
      tools,
    }
  }
  return out
}

export interface FoldedSample {
  at: number
  sessionId?: string
  callId?: string
  ok: boolean
  turn: number | null
  via: 'invocation' | 'tool'
  loadMs?: number
  error?: string
  window: {
    toolCalls: number
    errors: number
    errorNames: string[]
    mcp: Record<string, McpBucket>
    origin: string | null
    tokens: Partial<Tokens>
    loopErrors: number
    llmRetries: number
    closeReason: string | null
    lastLoopError: string | null
    corrections: string[]
    otherSkills: string[]
    turnEnded: boolean
    truncated: boolean
  } | null
}

/**
 * Fold append-only events into per-skill invocation samples.
 *
 * Record shapes written by the plugin:
 *   { t:'skill', v:1, at, sessionId, callId, skill, ok, loadMs, error?, windowId }
 *   { t:'window', v:1, at, windowId, sessionId, skill, toolCalls, errors,
 *     errorNames[], corrections[], otherSkills[], turnEnded, truncated }
 */
export function foldSamples(records: readonly StoredRecord[]) {
  const byWindow = new Map<string, StoredRecord>()
  for (const r of records) {
    if (r && r.t === 'window' && typeof r.windowId === 'string') byWindow.set(r.windowId, r)
  }
  const bySkill = new Map<string, { skill: string; samples: FoldedSample[]; firstAt: number; lastAt: number }>()
  // A hot reload drops the recorder's in-memory invocation dedupe, so the same
  // injected /skill-name message can be recorded twice. Collapse it here on
  // the durable read path (same session + message id + invocation origin).
  const seenInvocations = new Set<string>()
  for (const r of records) {
    if (!r || r.t !== 'skill' || typeof r.skill !== 'string') continue
    if (r.via === 'invocation') {
      const key = `${r.sessionId ?? ''}|${r.callId ?? ''}`
      if (seenInvocations.has(key)) continue
      seenInvocations.add(key)
    }
    const entry = bySkill.get(r.skill) ?? { skill: r.skill, samples: [], firstAt: r.at, lastAt: r.at }
    const window = r.windowId ? byWindow.get(r.windowId) : undefined
    // Cross-skill windowId collision (invocation id vs tool callId) must not
    // attach another skill's window: drop the join on mismatch.
    const joined = window && typeof window.skill === 'string' && window.skill !== r.skill ? undefined : window
    entry.samples.push({
      at: r.at,
      sessionId: r.sessionId,
      callId: r.callId,
      ok: r.ok === true,
      turn: typeof r.turn === 'number' ? r.turn : null,
      via: r.via === 'invocation' ? 'invocation' : 'tool',
      loadMs: typeof r.loadMs === 'number' ? r.loadMs : undefined,
      error: r.error,
      window: joined
        ? {
            toolCalls: Number(joined.toolCalls) || 0,
            errors: Number(joined.errors) || 0,
            errorNames: Array.isArray(joined.errorNames)
              ? joined.errorNames.filter((name: unknown) => typeof name === 'string')
              : [],
            mcp: sanitizeMcp(joined.mcp),
            origin: typeof joined.origin === 'string' ? joined.origin : null,
            tokens:
              joined.tokens && typeof joined.tokens === 'object'
                ? joined.tokens
                : { input: 0, output: 0, cacheRead: 0, calls: 0 },
            loopErrors: Number(joined.loopErrors) || 0,
            llmRetries: Number(joined.llmRetries) || 0,
            closeReason: typeof joined.closeReason === 'string' ? joined.closeReason : null,
            lastLoopError: typeof joined.lastLoopError === 'string' ? joined.lastLoopError : null,
            corrections: Array.isArray(joined.corrections) ? joined.corrections : [],
            otherSkills: Array.isArray(joined.otherSkills) ? joined.otherSkills : [],
            turnEnded: joined.turnEnded === true,
            truncated: joined.truncated === true,
          }
        : null,
    })
    entry.firstAt = Math.min(entry.firstAt ?? r.at, r.at)
    entry.lastAt = Math.max(entry.lastAt ?? r.at, r.at)
    bySkill.set(r.skill, entry)
  }
  return [...bySkill.values()].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
}
