import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

function expandHome(p) {
  if (typeof p !== 'string' || p.length === 0) return null
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return path.resolve(p)
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
  constructor(dir) {
    this.dir = dir
    this.file = path.join(dir, 'events.jsonl')
    this.queue = Promise.resolve()
    this.failed = null
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
    this.queue = this.queue
      .then(async () => {
        await fs.mkdir(this.dir, { recursive: true })
        // A crash can leave a record without its trailing newline. Appending on
        // top of that fragment would glue two records into one unparseable line
        // and silently lose the new record too, so close the torn tail first.
        try {
          const info = await fs.stat(this.file)
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
  for (const r of records) {
    if (!r || r.t !== 'skill' || typeof r.skill !== 'string') continue
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
            mcp: window.mcp && typeof window.mcp === 'object' && !Array.isArray(window.mcp) ? window.mcp : {},
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
