import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function expandHome(p) {
  if (typeof p !== 'string' || p.length === 0) return null
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return path.resolve(p)
}

/** Keep this much of events.jsonl before dropping its oldest half. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

/**
 * Create the telemetry directory owner-only. Records carry user message
 * excerpts, so a custom DSH_SKILL_EVAL_DIR must not stay world readable; an
 * existing directory created by an older version is tightened as well.
 */
export async function ensurePrivateDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  try {
    await fs.chmod(dir, 0o700)
  } catch {
    // Best effort: a foreign-owned or read-only mount keeps its own policy.
  }
}

/**
 * Drop the oldest records once the file outgrows maxBytes. The cut lands on a
 * line boundary so a reader never sees half a record, and half the cap is kept
 * so the file is not rewritten on the next append.
 */
async function rotateFile(file, maxBytes) {
  let raw
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') return
    throw error
  }
  if (Buffer.byteLength(raw) <= maxBytes) return
  const keep = Math.max(1, Math.floor(maxBytes / 2))
  const lines = raw.split('\n').filter((line) => line.length > 0)
  const kept = []
  let bytes = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const size = Buffer.byteLength(lines[index]) + 1
    if (kept.length > 0 && bytes + size > keep) break
    kept.push(lines[index])
    bytes += size
  }
  kept.reverse()
  const temp = `${file}.tmp`
  await fs.writeFile(temp, `${kept.join('\n')}\n`, 'utf8')
  await fs.rename(temp, file)
}

/**
 * Where telemetry lives. Kept OUTSIDE the session log on purpose: the session
 * log is the harness's source of truth and plugins must not append foreign
 * event types to it.
 */
export function resolveDataDir(config = {}) {
  const explicit = expandHome(config.dataDir) || expandHome(process.env.DSH_SKILL_EVAL_DIR)
  if (explicit) return explicit
  const home = expandHome(process.env.DSH_HOME) || path.join(os.homedir(), '.dsh')
  const profile = process.env.DSH_PROFILE || 'default'
  return path.join(home, 'skill-eval', profile)
}

/**
 * Append-only JSONL store. Writes are serialized through one promise chain so
 * concurrent tool results cannot interleave partial lines.
 */
export class EventStore {
  constructor(dir, options = {}) {
    this.dir = dir
    this.file = path.join(dir, 'events.jsonl')
    this.queue = Promise.resolve()
    this.pending = 0
    this.failed = null
    const cap = Number(options.maxBytes)
    this.maxBytes = Number.isFinite(cap) && cap > 0 ? Math.floor(cap) : DEFAULT_MAX_BYTES
    this.privateDir = false
    // Bumped on every successful append; the analyzer uses it to invalidate a
    // cached report without re-reading the whole store on every request.
    this.version = 0
  }

  append(record) {
    let line
    try {
      line = JSON.stringify(record)
    } catch {
      return Promise.resolve()
    }
    if (typeof line !== 'string') return Promise.resolve()
    this.pending += 1
    this.queue = this.queue
      .then(async () => {
        await fs.mkdir(this.dir, { recursive: true, mode: 0o700 })
        // Tighten once per process: telemetry may predate the owner-only mode,
        // and silently leaving it world readable is the documented residual.
        if (!this.privateDir) {
          this.privateDir = true
          try {
            await fs.chmod(this.dir, 0o700)
          } catch {
            // foreign-owned or read-only mount: keep whatever policy it has
          }
        }
        // A crash can leave a record without its trailing newline. Appending on
        // top of that fragment would glue two records into one unparseable line
        // and silently lose the new record too, so close the torn tail first.
        let size = 0
        try {
          const info = await fs.stat(this.file)
          size = info.size
          if (info.size > 0) {
            const handle = await fs.open(this.file, 'r')
            try {
              const last = Buffer.alloc(1)
              await handle.read(last, 0, 1, info.size - 1)
              if (last[0] !== 0x0a) await fs.appendFile(this.file, '\n', 'utf8')
            } finally {
              await handle.close()
            }
          }
        } catch (error) {
          if (!error || error.code !== 'ENOENT') throw error
        }
        // Bound the file: drop the oldest half once this record would overflow
        // it. A single record larger than the cap is still kept, otherwise the
        // append would be silently discarded.
        if (size > 0 && size + Buffer.byteLength(line) + 1 > this.maxBytes) await rotateFile(this.file, this.maxBytes)
        await fs.appendFile(this.file, line + '\n', 'utf8')
        this.failed = null
        this.version += 1
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        const first = this.failed === null
        this.failed = message
        if (first && typeof this.onError === 'function') {
          try {
            this.onError(message)
          } catch {
            // the logger itself must never break recording
          }
        }
      })
      .finally(() => {
        this.pending = Math.max(0, this.pending - 1)
      })
    return this.queue
  }

  /** Read every parseable record; malformed lines from a crash are skipped. */
  async readAll() {
    let raw
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') return []
      throw error
    }
    const out = []
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

  async size() {
    try {
      const st = await fs.stat(this.file)
      return st.size
    } catch {
      return 0
    }
  }

  /** Cheap identity of the current file contents for report caching. */
  async stamp() {
    try {
      const st = await fs.stat(this.file)
      return `${st.mtimeMs}:${st.size}`
    } catch {
      return 'missing'
    }
  }
}

function finiteNumbers(value, limit) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const item of value) {
    if (typeof item === 'number' && Number.isFinite(item) && out.length < limit) out.push(item)
  }
  return out
}

/**
 * Normalise a persisted MCP bucket tree. A hand-edited or corrupted window
 * record (a null tool entry, a string where an object belongs) must never be
 * able to crash the report surfaces, so every level is type-checked here.
 */
export function sanitizeMcp(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = Object.create(null)
  for (const [server, bucket] of Object.entries(value)) {
    if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue
    const tools = Object.create(null)
    for (const [tool, stats] of Object.entries(bucket.tools ?? {})) {
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

/**
 * Fold append-only events into per-skill invocation samples.
 *
 * Record shapes written by the plugin:
 *   { t:'skill', v:1, at, sessionId, callId, skill, ok, loadMs, error?, windowId }
 *   { t:'window', v:1, at, windowId, sessionId, skill, toolCalls, errors,
 *     errorNames[], corrections[], otherSkills[], turnEnded, truncated }
 */
export function foldSamples(records) {
  const byWindow = new Map()
  for (const r of records) {
    if (r && r.t === 'window' && typeof r.windowId === 'string') byWindow.set(r.windowId, r)
  }
  const bySkill = new Map()
  // A hot reload drops the recorder's in-memory invocation dedupe, so the same
  // injected /skill-name message can be recorded twice. Collapse it here on
  // the durable read path (same session + message id + invocation origin).
  const seenInvocations = new Set()
  for (const r of records) {
    if (!r || r.t !== 'skill' || typeof r.skill !== 'string') continue
    if (r.via === 'invocation') {
      const key = `${r.sessionId ?? ''}|${r.callId ?? ''}`
      if (seenInvocations.has(key)) continue
      seenInvocations.add(key)
    }
    const entry = bySkill.get(r.skill) ?? { skill: r.skill, samples: [], firstAt: r.at, lastAt: r.at }
    const window = r.windowId ? byWindow.get(r.windowId) : undefined
    entry.samples.push({
      at: r.at,
      sessionId: r.sessionId,
      callId: r.callId,
      ok: r.ok === true,
      turn: typeof r.turn === 'number' ? r.turn : null,
      via: r.via === 'invocation' ? 'invocation' : 'tool',
      loadMs: typeof r.loadMs === 'number' ? r.loadMs : undefined,
      error: r.error,
      window: window
        ? {
            toolCalls: Number(window.toolCalls) || 0,
            errors: Number(window.errors) || 0,
            errorNames: Array.isArray(window.errorNames)
              ? window.errorNames.filter((name) => typeof name === 'string')
              : [],
            mcp: sanitizeMcp(window.mcp),
            origin: typeof window.origin === 'string' ? window.origin : null,
            tokens:
              window.tokens && typeof window.tokens === 'object'
                ? window.tokens
                : { input: 0, output: 0, cacheRead: 0, calls: 0 },
            loopErrors: Number(window.loopErrors) || 0,
            llmRetries: Number(window.llmRetries) || 0,
            closeReason: typeof window.closeReason === 'string' ? window.closeReason : null,
            lastLoopError: typeof window.lastLoopError === 'string' ? window.lastLoopError : null,
            corrections: Array.isArray(window.corrections) ? window.corrections : [],
            otherSkills: Array.isArray(window.otherSkills) ? window.otherSkills : [],
            turnEnded: window.turnEnded === true,
            truncated: window.truncated === true,
          }
        : null,
    })
    entry.firstAt = Math.min(entry.firstAt ?? r.at, r.at)
    entry.lastAt = Math.max(entry.lastAt ?? r.at, r.at)
    bySkill.set(r.skill, entry)
  }
  return [...bySkill.values()].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
}
