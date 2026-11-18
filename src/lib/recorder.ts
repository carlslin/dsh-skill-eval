import { stat as statFile } from 'node:fs/promises'
import path from 'node:path'
import { checkReferences } from './integrity.ts'
import { isCorrection, staticProfile } from './score.ts'
import type { SkillSummary } from './score.ts'
import type { EventStore } from './store.ts'
import type { Host, McpBucket, Tokens } from './types.ts'

const MAX_TRACKED_SESSIONS = 128

/** Best-effort text extraction from a user message of unknown shape. */
export function messageText(message: Host): string {
  if (!message || typeof message !== 'object') return ''
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .map((block: Host) => {
        if (!block || typeof block !== 'object') return ''
        if (typeof block.text === 'string') return block.text
        if (typeof block.value === 'string') return block.value
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (typeof message.text === 'string') return message.text
  return ''
}

function skillNameOf(args: Host): string | null {
  if (!args || typeof args !== 'object') return null
  const candidate = args.name ?? args.skill ?? args.skillName
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : null
}

/**
 * MCP tools reach the model as `mcp__<server>__<tool>`, so the telemetry can
 * split one skill's window by MCP server without any extra configuration.
 */
export function mcpOf(toolName: unknown): { server: string; tool: string } | null {
  if (typeof toolName !== 'string' || !toolName.startsWith('mcp__')) return null
  const rest = toolName.slice('mcp__'.length)
  const cut = rest.indexOf('__')
  if (cut <= 0) return { server: rest, tool: '' }
  return { server: rest.slice(0, cut), tool: rest.slice(cut + 2) }
}

function errorNameOf(result: Host): string {
  const info = result?.error?.info
  if (info && typeof info.name === 'string' && info.name.length > 0) return info.name
  return 'ToolError'
}

/** Session origin, so short-lived subagent runs can be judged differently. */
function originOf(agent: Host): string | null {
  try {
    const origin = agent && agent.session && agent.session.header ? agent.session.header.origin : null
    return typeof origin === 'string' && origin.length > 0 ? origin : null
  } catch {
    return null
  }
}

function nowMs() {
  return Date.now()
}

interface LiveWindow {
  windowId: string
  sessionId: string
  skill: string
  toolCalls: number
  errors: number
  errorNames: string[]
  loopErrors: number
  llmRetries: number
  lastLoopError: string | null
  mcp: Record<string, McpBucket>
  tokens: Tokens
  corrections: string[]
  otherSkills: string[]
  turnEnded: boolean
  truncated: boolean
  step: number | undefined
  origin: string | null
  openedAt: number
  lastActivityAt: number
  flushed: boolean
}

interface SessionState {
  windows: LiveWindow[]
  lastAt: number
}

interface StepAccumulator {
  startedAt: number
  sessionId: string
  turn: number | null
  step: number | null
  toolCalls: number
  errors: number
  errorNames: string[]
  mcpCalls: number
  mcpErrors: number
  loopErrors: number
  skills: string[]
  tokens: Tokens
}

export type ResolveSkill = (
  skill: string,
  agent: Host,
  signal?: AbortSignal,
) => Promise<{ summary?: SkillSummary; definition?: { content?: unknown; path?: string | null } } | null>

export interface RecorderConfig {
  windowToolCalls?: number
  windowTtlMs?: number
  countTokens?: boolean
}

/**
 * Live telemetry recorder.
 *
 * A "window" is the stretch of work that follows one `skill` load inside one
 * session. The window stays open across the turn boundary on purpose: the
 * evidence that a skill failed to help is usually the *next* user message ("no,
 * that's wrong"), so the window must survive until that message arrives.
 *
 * Each window is persisted when the turn ends and re-persisted when it finally
 * closes (with the correction attached). Readers keep the last record per
 * windowId, so a re-persist is an update, not a duplicate.
 */
export function createRecorder(
  ctx: Host,
  config: RecorderConfig,
  { store, resolveSkill }: { store: Pick<EventStore, 'append' | 'queue'>; resolveSkill?: ResolveSkill },
) {
  const starts = new Map<unknown, number>() // callId -> ms timestamp
  const steps = new Map<string, number>() // sessionId -> current loop step number
  const turns = new Map<string, number>() // sessionId -> current turn number
  const stepStats = new Map<string, StepAccumulator>() // sessionId -> accumulator for the current step
  // A user-typed `/skill-name` is injected as a user message on every following
  // step, so the message id is the dedupe key for that load path.
  const seenInvocations = new Set<string>()
  // A session can have several windows open at once: parallel `skill` loads in
  // one loop step are concurrent use, so their follow-up work counts for each of
  // them instead of being handed to whichever loaded last.
  const sessions = new Map<string, SessionState>() // sessionId -> { windows: [] }

  const windowLimit = Math.max(1, Number(config.windowToolCalls ?? 12))
  // Read live: the settings form advertises windowTtlMs as applying immediately.
  const ttlMs = () => Math.max(60_000, Number(config.windowTtlMs ?? 30 * 60_000))

  function stateFor(sessionId: string): SessionState {
    const existing = sessions.get(sessionId)
    if (existing) {
      existing.lastAt = nowMs()
      return existing
    }
    if (sessions.size >= MAX_TRACKED_SESSIONS) {
      // Evict least-recently-active, not least-recently-created: a root turn
      // that just loaded a skill must not lose its window to a burst of
      // short-lived subagent sessions.
      let oldest: string | null = null
      let oldestAt = Infinity
      for (const [id, candidate] of sessions) {
        const at = candidate.lastAt ?? 0
        if (at < oldestAt) {
          oldestAt = at
          oldest = id
        }
      }
      if (oldest !== null) {
        const stale = sessions.get(oldest)
        if (stale) closeWindows(stale, 'evicted')
        flushStep(oldest, 'evicted')
        sessions.delete(oldest)
        steps.delete(oldest)
        turns.delete(oldest)
      }
    }
    const state: SessionState = { windows: [], lastAt: nowMs() }
    sessions.set(sessionId, state)
    return state
  }

  function persist(w: LiveWindow | undefined, closeReason: string): void {
    if (!w) return
    w.flushed = true
    void store.append({
      t: 'window',
      v: 1,
      at: nowMs(),
      windowId: w.windowId,
      sessionId: w.sessionId,
      skill: w.skill,
      toolCalls: w.toolCalls,
      errors: w.errors,
      errorNames: w.errorNames.slice(0, 12),
      loopErrors: w.loopErrors,
      llmRetries: w.llmRetries,
      lastLoopError: w.lastLoopError,
      mcp: w.mcp,
      tokens: w.tokens,
      corrections: w.corrections.map((text) => text.slice(0, 200)),
      otherSkills: [...w.otherSkills],
      origin: w.origin,
      step: w.step,
      turnEnded: w.turnEnded,
      truncated: w.truncated,
      closeReason,
    })
  }

  function closeWindows(state: SessionState | undefined, reason: string, except?: LiveWindow): void {
    if (!state || state.windows.length === 0) return
    const closing = state.windows.filter((w) => w !== except)
    state.windows = except ? [except] : []
    for (const w of closing) persist(w, reason)
  }

  function openWindow(
    state: SessionState,
    skill: string,
    sessionId: string,
    callId: unknown,
    step: number | undefined,
    origin: string | null,
  ): void {
    const current = state.windows[state.windows.length - 1]
    if (current) {
      // Two loads inside one loop step run concurrently: that is parallel use,
      // not the model abandoning one skill for another. Only a load in a later
      // step disagrees with what the previous skill was doing.
      const sameStep = step !== undefined && current.step === step
      if (sameStep) {
        // keep the sibling window open; the same follow-up work serves both
      } else {
        for (const w of state.windows) if (w.skill !== skill) w.otherSkills.push(skill)
        closeWindows(state, 'superseded')
      }
    }
    state.windows.push({
      windowId: `${sessionId}:${callId}`,
      sessionId,
      skill,
      toolCalls: 0,
      errors: 0,
      errorNames: [],
      loopErrors: 0,
      llmRetries: 0,
      lastLoopError: null,
      mcp: Object.create(null),
      tokens: { input: 0, output: 0, cacheRead: 0, calls: 0 },
      corrections: [],
      otherSkills: [],
      turnEnded: false,
      truncated: false,
      step,
      origin,
      openedAt: nowMs(),
      lastActivityAt: nowMs(),
      flushed: false,
    })
  }

  /**
   * Static authoring quality cannot be resolved at report time: the skill
   * catalog is layered per agent scope, and by then no agent is available. So
   * resolve it once, at load time, while `exec.agent` is still in hand.
   */
  async function captureStatic(skill: string, agent: Host, signal: AbortSignal | undefined, fallbackContent: unknown) {
    try {
      if (typeof resolveSkill !== 'function') return
      let resolved = null
      try {
        resolved = await resolveSkill(skill, agent, signal)
      } catch {
        resolved = null
      }
      const value: { content: string; provider?: string } | null =
        typeof fallbackContent === 'string' ? { content: fallbackContent } : null
      const definition =
        resolved?.definition ?? (value && typeof value.content === 'string' ? { content: value.content } : undefined)
      const summary: SkillSummary | undefined =
        resolved?.summary ??
        (value && typeof value.content === 'string'
          ? { name: skill, description: '', whenToUse: '', source: value.provider ?? null }
          : undefined)
      // Reference integrity needs the filesystem view, so it is resolved here,
      // while the skill directory is still known, and handed to the pure profile.
      let integrity = null
      try {
        const baseDir =
          (summary &&
            typeof summary.resourceBase === 'object' &&
            summary.resourceBase &&
            summary.resourceBase.kind === 'directory' &&
            summary.resourceBase.path) ||
          (summary && typeof summary.path === 'string' ? path.dirname(summary.path) : null)
        if (baseDir && definition) {
          integrity = await checkReferences({ baseDir, content: definition.content, stat: statFile })
        }
      } catch {
        integrity = null
      }
      const profile = staticProfile(summary, definition, { integrity })
      if (!profile) return
      await store.append({
        t: 'static',
        v: 1,
        at: nowMs(),
        skill,
        source: profile.source,
        static: profile,
      })
    } catch {
      // static capture is optional
    }
  }

  function flushStep(sessionId: string, closeReason = 'next-step'): void {
    const step = stepStats.get(sessionId)
    if (!step) return
    stepStats.delete(sessionId)
    const active =
      step.toolCalls > 0 || step.errors > 0 || step.loopErrors > 0 || step.skills.length > 0 || step.tokens.calls > 0
    if (!active) return
    void store.append({
      t: 'step',
      v: 1,
      at: nowMs(),
      sessionId,
      turn: step.turn,
      step: step.step,
      startedAt: step.startedAt,
      durationMs: Math.max(0, nowMs() - step.startedAt),
      toolCalls: step.toolCalls,
      errors: step.errors,
      errorNames: step.errorNames.slice(0, 8),
      mcpCalls: step.mcpCalls,
      mcpErrors: step.mcpErrors,
      loopErrors: step.loopErrors,
      skills: [...step.skills],
      tokens: step.tokens,
      closeReason,
    })
  }

  function beginStep(sessionId: string, turn: unknown, stepNumber: unknown): void {
    flushStep(sessionId, 'next-step')
    stepStats.set(sessionId, {
      startedAt: nowMs(),
      sessionId,
      turn: Number.isFinite(Number(turn)) ? Number(turn) : null,
      step: Number.isFinite(Number(stepNumber)) ? Number(stepNumber) : null,
      toolCalls: 0,
      errors: 0,
      errorNames: [],
      mcpCalls: 0,
      mcpErrors: 0,
      loopErrors: 0,
      skills: [],
      tokens: { input: 0, output: 0, cacheRead: 0, calls: 0 },
    })
  }

  const offs: Array<() => void> = []

  /**
   * The `skill` tool is not the only way a skill gets loaded: a user-typed
   * `/skill-name` is resolved by the harness and injected as a user message with
   * `source: { kind: 'skill-invocation', name }` — no tool call, so it would
   * otherwise be invisible. The message repeats on later steps, hence the id
   * dedupe.
   */
  function recordInvocations(sessionId: string, messages: Host, agent: Host): void {
    if (!Array.isArray(messages)) return
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue
      const source = message.source
      if (!source || source.kind !== 'skill-invocation') continue
      const skill = typeof source.name === 'string' && source.name.length > 0 ? source.name : null
      if (!skill) continue
      const id = typeof message.id === 'string' ? message.id : `${skill}:${sessionId}`
      const seenKey = `${sessionId}|${id}`
      if (seenInvocations.has(seenKey)) continue
      seenInvocations.add(seenKey)
      // Evict the oldest keys instead of clearing everything: a wholesale
      // reset would let a repeated invocation message be recorded twice.
      if (seenInvocations.size > 4000) {
        for (let i = 0; i < 500; i += 1) {
          const oldest = seenInvocations.values().next().value
          if (oldest === undefined) break
          seenInvocations.delete(oldest)
        }
      }
      const state = stateFor(sessionId)
      const windowId = `${sessionId}:${id}`
      void store.append({
        t: 'skill',
        v: 1,
        at: nowMs(),
        sessionId,
        callId: id,
        skill,
        ok: true,
        via: 'invocation',
        origin: originOf(agent),
        turn: turns.get(sessionId),
        windowId,
      })
      openWindow(state, skill, sessionId, id, steps.get(sessionId), originOf(agent))
      void captureStatic(skill, agent, undefined, undefined)
    }
  }

  // The loop step is the only way to tell "loaded A and B together" (parallel
  // work in one step) from "loaded A, then switched to B". Pass the waterfall
  // through untouched.
  offs.push(
    ctx.on('agent/pre-step', (payload: Host, next: () => unknown) => {
      try {
        if (payload && payload.agent) {
          const sessionId = String(payload.agent.id)
          steps.set(sessionId, payload.step)
          if (typeof payload.turn === 'number') turns.set(sessionId, payload.turn)
          beginStep(sessionId, payload.turn ?? turns.get(sessionId), payload.step)
          recordInvocations(sessionId, payload.messages, payload.agent)
        }
      } catch {
        // never interfere with the loop
      }
      return next()
    }),
  )

  // The loop can fail on its own (a broken step, a failed model request, an
  // aborted tool batch). That is evidence about the skill that was loaded right
  // before it, so it lands inside the open windows instead of being lost.
  offs.push(
    ctx.on('agent/error', (payload: Host) => {
      try {
        const sessionId = payload && payload.agent ? String(payload.agent.id) : null
        if (!sessionId) return
        const state = sessions.get(sessionId)
        const step = stepStats.get(sessionId)
        if (step) step.loopErrors += 1
        if (!state || state.windows.length === 0) return
        const error = payload.error
        const label =
          error instanceof Error
            ? error.name || 'Error'
            : error && typeof error === 'object' && typeof error.code === 'string'
              ? error.code
              : 'AgentError'
        for (const w of state.windows) {
          w.loopErrors += 1
          w.lastLoopError = label
        }
      } catch {
        // ignore
      }
    }),
  )

  offs.push(
    ctx.on('agent/request-error', (payload: Host, next: () => unknown) => {
      try {
        const sessionId = payload && payload.agent ? String(payload.agent.id) : null
        if (sessionId) {
          const state = sessions.get(sessionId)
          if (state && state.windows.length > 0) {
            for (const w of state.windows) w.llmRetries += 1
          }
        }
      } catch {
        // ignore
      }
      return next()
    }),
  )

  // Start timing on skill loads only; pass the waterfall through untouched.
  offs.push(
    ctx.on('tools/pre-execute', (exec: Host, next: () => unknown) => {
      try {
        if (exec && exec.callId !== undefined) {
          starts.set(exec.callId, nowMs())
          if (starts.size > 512) starts.delete(starts.keys().next().value)
        }
      } catch {
        // never interfere with execution
      }
      return next()
    }),
  )

  offs.push(
    ctx.on('tools/result', (exec: Host, result: Host) => {
      try {
        if (!exec || !exec.agent) return
        const sessionId = String(exec.agent.id)
        const state = stateFor(sessionId)
        const step = stepStats.get(sessionId)
        const mcpCall = mcpOf(exec.name)
        if (step) {
          step.toolCalls += 1
          if (result?.isError === true) {
            step.errors += 1
            if (step.errorNames.length < 8) step.errorNames.push(errorNameOf(result))
          }
          if (mcpCall) {
            step.mcpCalls += 1
            if (result?.isError === true) step.mcpErrors += 1
          }
          if (exec.name === 'skill') {
            const loaded = skillNameOf(exec.arguments)
            if (loaded && !step.skills.includes(loaded)) step.skills.push(loaded)
          }
        }
        const newest = state.windows[state.windows.length - 1]
        if (newest && nowMs() - newest.lastActivityAt > ttlMs()) closeWindows(state, 'stale')

        if (exec.name === 'skill') {
          const skill = skillNameOf(exec.arguments)
          const started = starts.get(exec.callId)
          starts.delete(exec.callId)
          if (!skill) return
          const ok = result?.isError !== true
          const windowId = `${sessionId}:${exec.callId}`
          void store.append({
            t: 'skill',
            v: 1,
            at: nowMs(),
            sessionId,
            callId: exec.callId,
            skill,
            ok,
            loadMs: started === undefined ? undefined : nowMs() - started,
            error: ok ? undefined : String(result?.error?.message ?? 'load failed').slice(0, 300),
            origin: originOf(exec.agent),
            turn: turns.get(sessionId),
            windowId,
          })
          if (ok) {
            openWindow(state, skill, sessionId, exec.callId, steps.get(sessionId), originOf(exec.agent))
            void captureStatic(
              skill,
              exec.agent,
              exec.signal,
              result?.value && typeof result.value.content === 'string' ? result.value.content : undefined,
            )
          }
          return
        }

        if (state.windows.length === 0) return
        const current = steps.get(sessionId)
        // Count the call for every window still open in this step: a parallel
        // batch of skill loads is one piece of work, not one winner.
        const targets = state.windows.filter((w) => current === undefined || w.step === undefined || w.step === current)
        const startedAt = starts.get(exec.callId)
        if (exec.callId !== undefined) starts.delete(exec.callId)
        const elapsed = startedAt === undefined ? undefined : nowMs() - startedAt
        const mcp = mcpOf(exec.name)
        for (const w of targets.length > 0 ? targets : state.windows) {
          w.lastActivityAt = nowMs()
          if (state) state.lastAt = nowMs()
          if (mcp) {
            if (!Object.hasOwn(w.mcp, mcp.server)) {
              w.mcp[mcp.server] = { calls: 0, errors: 0, ms: 0, samples: [], tools: Object.create(null) }
            }
            const bucket = w.mcp[mcp.server]
            bucket.calls += 1
            if (result?.isError === true) bucket.errors += 1
            if (elapsed !== undefined) {
              bucket.ms += elapsed
              // keep a bounded latency sample so the report can show p50/p95,
              // not just a mean that one slow call can distort
              if (!Array.isArray(bucket.samples)) bucket.samples = []
              if (bucket.samples.length < 40) bucket.samples.push(elapsed)
            }
            if (mcp.tool) {
              const tool = Object.hasOwn(bucket.tools, mcp.tool)
                ? bucket.tools[mcp.tool]
                : { calls: 0, errors: 0, ms: 0, samples: [] }
              tool.calls += 1
              if (result?.isError === true) tool.errors += 1
              if (elapsed !== undefined) {
                tool.ms = (tool.ms ?? 0) + elapsed
                if (!Array.isArray(tool.samples)) tool.samples = []
                if (tool.samples.length < 20) tool.samples.push(elapsed)
              }
              bucket.tools[mcp.tool] = tool
            }
            w.mcp[mcp.server] = bucket
          }
          if (w.toolCalls >= windowLimit) {
            w.truncated = true
            continue
          }
          w.toolCalls += 1
          if (result?.isError === true) {
            w.errors += 1
            if (w.errorNames.length < 12) w.errorNames.push(errorNameOf(result))
          }
        }
      } catch {
        // telemetry must never break tool execution
      }
    }),
  )

  // The next user message is the strongest signal about the last run: either it
  // is a correction (the skill failed) or it is a normal follow-up (it worked).
  offs.push(
    ctx.on('agent/inbox/claimed', (payload: Host) => {
      try {
        const sessionId = payload?.agent ? String(payload.agent.id) : null
        if (!sessionId) return
        const state = sessions.get(sessionId)
        if (!state || state.windows.length === 0) return
        const newest = state.windows[state.windows.length - 1]
        if (nowMs() - newest.lastActivityAt > ttlMs()) {
          closeWindows(state, 'stale')
          return
        }
        const text = messageText(payload.message)
        if (text.length > 0 && isCorrection(text)) {
          for (const w of state.windows) w.corrections.push(text)
        }
        closeWindows(state, 'user-turn')
      } catch {
        // ignore
      }
    }),
  )

  // Real provider usage rides on every committed assistant message, so token
  // cost is measured instead of estimated. Usage belongs to the model call that
  // answered the current step, which is exactly the work an open window caused.
  offs.push(
    ctx.on('session/event', (session: Host, event: Host) => {
      try {
        if (config.countTokens === false || !event || event.type !== 'assistant/message') return
        const usage = event.data && event.data.usage
        if (!usage || typeof usage !== 'object') return
        const sessionId = session && session.id ? String(session.id) : null
        if (!sessionId) return
        const state = sessions.get(sessionId)
        const step = stepStats.get(sessionId)
        if (step) {
          step.tokens.input += Number(usage.inputTokens) || 0
          step.tokens.output += Number(usage.outputTokens) || 0
          step.tokens.cacheRead += Number(usage.cacheReadTokens) || 0
          step.tokens.calls += 1
        }
        if (!state || state.windows.length === 0) return
        for (const w of state.windows) {
          const bucket = w.tokens ?? { input: 0, output: 0, cacheRead: 0, calls: 0 }
          bucket.input += Number(usage.inputTokens) || 0
          bucket.output += Number(usage.outputTokens) || 0
          bucket.cacheRead += Number(usage.cacheReadTokens) || 0
          bucket.calls += 1
          w.tokens = bucket
        }
      } catch {
        // token accounting is best effort
      }
    }),
  )

  // Persist at turn end, but keep observing for the follow-up message.
  offs.push(
    ctx.on('agent/turn-stopping', (payload: Host) => {
      try {
        const sessionId = payload?.agent ? String(payload.agent.id) : null
        if (!sessionId) return
        flushStep(sessionId, 'turn-end')
        const state = sessions.get(sessionId)
        if (!state || state.windows.length === 0) return
        for (const w of state.windows) {
          w.turnEnded = true
          persist(w, 'turn-end')
        }
      } catch {
        // ignore
      }
    }),
  )

  return {
    /** Await every write queued so far (used by tests and by the snapshot flush). */
    flush() {
      return store.queue
    },
    async dispose() {
      for (const sessionId of [...stepStats.keys()]) flushStep(sessionId, 'dispose')
      for (const state of sessions.values()) closeWindows(state, 'dispose')
      sessions.clear()
      steps.clear()
      turns.clear()
      seenInvocations.clear()
      // let every queued write land before the caller tears the store down
      await store.queue
      for (const off of offs) {
        try {
          off()
        } catch {
          // ignore
        }
      }
    },
  }
}
