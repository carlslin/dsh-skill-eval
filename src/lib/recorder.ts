import { stat as statFile } from 'node:fs/promises'
import path from 'node:path'
import { checkReferences } from './integrity.ts'
import { isCorrection, staticProfile } from './score.ts'
import type { SkillSummary } from './score.ts'
import type { EventStore } from './store.ts'
import type {
  Host,
  McpBucket,
  Tokens,
  WindowApprovals,
  WindowContext,
  WindowFeedback,
  WindowModel,
  WindowOutcomes,
} from './types.ts'

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

const emptyFeedback = (): WindowFeedback => ({ positive: 0, negative: 0, categories: Object.create(null), notes: [] })
const emptyOutcomes = (): WindowOutcomes => ({
  deliverables: 0,
  workspaceChanges: 0,
  jobsSettled: 0,
  jobsFailed: 0,
  tasksCompleted: 0,
  tasksFailed: 0,
  workflowRuns: 0,
})
const emptyApprovals = (): WindowApprovals => ({ asked: 0, decided: 0, rejected: 0 })
const emptyContext = (): WindowContext => ({ compactions: 0, permissionPreset: null, sandboxMode: null })

/** Managed child agents are named; root sessions usually are not. */
function agentNameOf(agent: Host): string | null {
  try {
    const name = agent?.name ?? agent?.session?.header?.agentName ?? null
    return typeof name === 'string' && name.length > 0 ? name.slice(0, 80) : null
  } catch {
    return null
  }
}

function hasFeedback(f: WindowFeedback): boolean {
  return f.positive + f.negative > 0 || f.notes.length > 0 || Object.keys(f.categories).length > 0
}
function hasOutcomes(o: WindowOutcomes): boolean {
  return Object.values(o).some((n) => n > 0)
}
function hasApprovals(a: WindowApprovals): boolean {
  return a.asked + a.decided + a.rejected > 0
}
function hasContext(c: WindowContext): boolean {
  return c.compactions > 0 || c.permissionPreset !== null || c.sandboxMode !== null
}
function hasModel(m: WindowModel): boolean {
  return Boolean(m.provider || m.model || m.effort || m.preset)
}

function agentKindOf(origin: string | null): string {
  if (!origin) return 'root'
  if (origin === 'subagent' || origin === 'child') return 'subagent'
  return origin
}

interface SessionMeta {
  model: WindowModel
  permissionPreset: string | null
  sandboxMode: string | null
  agentName: string | null
  /** Rendered catalog description per skill, captured from the durable skill catalog. */
  catalog: Map<string, string>
  catalogComplete: boolean
  /** Whether a durable catalog message was actually observed this session. */
  catalogSeen: boolean
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
  agentName: string | null
  agentKind: string
  messageIds: string[]
  feedback: WindowFeedback
  outcomes: WindowOutcomes
  approvals: WindowApprovals
  context: WindowContext
  model: WindowModel
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
) => Promise<{
  summary?: SkillSummary
  definition?: { content?: unknown; path?: string | null }
  /** ctx.skills.snapshot().complete — false when some provider failed discovery. */
  catalogComplete?: boolean
} | null>

export interface RecorderConfig {
  windowToolCalls?: number
  windowTtlMs?: number
  countTokens?: boolean
  /**
   * Store only a redacted placeholder for user correction text (length +
   * correction flag) instead of the raw message. Rates still work; the report
   * shows "[redacted N chars]" instead of quoting the user.
   */
  redactCorrections?: boolean
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
  const sessionMeta = new Map<string, SessionMeta>()

  function metaFor(sessionId: string): SessionMeta {
    const existing = sessionMeta.get(sessionId)
    if (existing) return existing
    const created: SessionMeta = {
      model: {},
      permissionPreset: null,
      sandboxMode: null,
      agentName: null,
      catalog: new Map(),
      catalogComplete: true,
      catalogSeen: false,
    }
    sessionMeta.set(sessionId, created)
    return created
  }

  const windowLimit = () => Math.max(1, Number(config.windowToolCalls ?? 12))
  // Read live: the settings form advertises windowToolCalls/windowTtlMs as applying immediately.
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
        if (stale) {
          for (const w of stale.windows) w.truncated = true
          closeWindows(stale, 'evicted')
        }
        flushStep(oldest, 'evicted')
        sessions.delete(oldest)
        steps.delete(oldest)
        turns.delete(oldest)
        sessionMeta.delete(oldest)
      }
    }
    const state: SessionState = { windows: [], lastAt: nowMs() }
    sessions.set(sessionId, state)
    return state
  }

  const pendingStatics = new Set<Promise<unknown>>()
  function trackStatic(promise: Promise<unknown>): void {
    pendingStatics.add(promise)
    void promise.finally(() => pendingStatics.delete(promise))
  }

  function persist(w: LiveWindow | undefined, closeReason: string): void {
    if (!w) return
    w.flushed = true
    const redact = config.redactCorrections === true
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
      corrections: w.corrections.map((text) => (redact ? `[redacted ${text.length} chars]` : text.slice(0, 200))),
      otherSkills: [...w.otherSkills],
      origin: w.origin,
      step: w.step,
      turnEnded: w.turnEnded,
      truncated: w.truncated,
      agentName: w.agentName,
      agentKind: w.agentKind,
      messageIds: w.messageIds.slice(0, 20),
      feedback: hasFeedback(w.feedback) ? w.feedback : undefined,
      outcomes: hasOutcomes(w.outcomes) ? w.outcomes : undefined,
      approvals: hasApprovals(w.approvals) ? w.approvals : undefined,
      context: hasContext(w.context) ? w.context : undefined,
      model: hasModel(w.model) ? w.model : undefined,
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
    agentName?: string | null,
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
    const meta = metaFor(sessionId)
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
      agentName: agentName ?? meta.agentName,
      agentKind: agentKindOf(origin),
      messageIds: [],
      feedback: emptyFeedback(),
      outcomes: emptyOutcomes(),
      approvals: emptyApprovals(),
      context: { ...emptyContext(), permissionPreset: meta.permissionPreset, sandboxMode: meta.sandboxMode },
      model: { ...meta.model },
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
  /**
   * The model-facing catalog is a durable user message: it carries the exact
   * rendered description (whitespace-normalized, truncated to the configured
   * cap) plus the discovery-completeness flag. Capture it so authoring checks
   * judge what the model actually sees instead of the raw frontmatter.
   */
  function recordCatalog(sessionId: string, messages: Host): void {
    if (!Array.isArray(messages)) return
    const meta = metaFor(sessionId)
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue
      const source = message.source
      if (!source || source.kind !== 'skill-catalog' || !Array.isArray(source.entries)) continue
      if (source.form === 'catalog') meta.catalog.clear()
      for (const entry of source.entries) {
        if (!entry || typeof entry !== 'object' || typeof entry.name !== 'string') continue
        meta.catalog.set(entry.name, typeof entry.description === 'string' ? entry.description : '')
      }
      meta.catalogComplete = source.incomplete !== true
      meta.catalogSeen = true
      return
    }
  }

  function catalogHint(sessionId: string, skill: string): { description?: string; complete?: boolean } {
    const meta = metaFor(sessionId)
    return { description: meta.catalog.get(skill), complete: meta.catalogSeen ? meta.catalogComplete : undefined }
  }

  // Latest explicit feedback per assistant message. Feedback is an editable
  // log: a put can replace an earlier rating, so windows are recomputed from
  // the current map instead of incrementing counters per event.
  const feedbackByMessage = new Map<string, { rating: string; category: string | null; note: string | null }>()

  function noteText(text: string): string {
    return config.redactCorrections === true ? `[redacted ${text.length} chars]` : text.slice(0, 300)
  }

  function refreshFeedback(w: LiveWindow): void {
    const feedback = emptyFeedback()
    for (const id of w.messageIds) {
      const item = feedbackByMessage.get(`${w.sessionId}|${id}`)
      if (!item) continue
      if (item.rating === 'positive') feedback.positive += 1
      else if (item.rating === 'negative') feedback.negative += 1
      if (item.category) feedback.categories[item.category] = (feedback.categories[item.category] ?? 0) + 1
      if (item.note && feedback.notes.length < 4) feedback.notes.push(noteText(item.note))
    }
    w.feedback = feedback
  }

  function failureStatus(data: Host): string {
    const raw = data?.status ?? data?.outcome ?? data?.state ?? data?.kind ?? ''
    return typeof raw === 'string' ? raw.toLowerCase() : ''
  }

  function isFailure(status: string): boolean {
    return /fail|error|cancel|timeout|reject|den(y|ied)|refus|abort/.test(status)
  }

  async function captureStatic(
    skill: string,
    agent: Host,
    signal: AbortSignal | undefined,
    fallbackContent: unknown,
    catalog?: { description?: string; complete?: boolean },
  ) {
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
      const profile = staticProfile(summary, definition, {
        integrity,
        catalogDescription: catalog?.description,
        catalogComplete: catalog?.complete ?? resolved?.catalogComplete,
      })
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
    recordCatalog(sessionId, messages)
    const meta = metaFor(sessionId)
    if (!meta.agentName) meta.agentName = agentNameOf(agent)
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
      // Namespaced so a user-typed invocation id can never collide with a tool
      // callId and cross-contaminate another skill's window in foldSamples.
      const windowId = `inv:${sessionId}:${id}`
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
      openWindow(state, skill, sessionId, id, steps.get(sessionId), originOf(agent), agentNameOf(agent))
      trackStatic(captureStatic(skill, agent, undefined, undefined, catalogHint(sessionId, skill)))
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
        // Expire each window on its own clock: a busy newest window must not
        // keep an idle sibling alive forever, nor misattribute later work.
        // No early return: a first skill load arrives with zero open windows
        // and must still be recorded below.
        if (state.windows.length > 0) {
          const now = nowMs()
          const ttl = ttlMs()
          const expired = state.windows.filter((w) => now - w.lastActivityAt > ttl)
          if (expired.length > 0) {
            state.windows = state.windows.filter((w) => now - w.lastActivityAt <= ttl)
            for (const w of expired) persist(w, 'stale')
          }
        }

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
            openWindow(
              state,
              skill,
              sessionId,
              exec.callId,
              steps.get(sessionId),
              originOf(exec.agent),
              agentNameOf(exec.agent),
            )
            trackStatic(
              captureStatic(
                skill,
                exec.agent,
                exec.signal,
                result?.value && typeof result.value.content === 'string' ? result.value.content : undefined,
                catalogHint(sessionId, skill),
              ),
            )
          }
          return
        }

        if (state.windows.length === 0) return
        const current = steps.get(sessionId)
        // Count the call for every window still open in this step: a parallel
        // batch of skill loads is one piece of work, not one winner.
        // An undefined-step window only matches when the current step is also
        // unknown — otherwise a legacy window would swallow all later work.
        const targets = state.windows.filter(
          (w) => current === undefined || (w.step === undefined ? false : w.step === current),
        )
        const startedAt = starts.get(exec.callId)
        if (exec.callId !== undefined) starts.delete(exec.callId)
        const elapsed = startedAt === undefined ? undefined : nowMs() - startedAt
        const mcp = mcpOf(exec.name)
        for (const w of targets.length > 0 ? targets : state.windows) {
          w.lastActivityAt = nowMs()
          if (state) state.lastAt = nowMs()
          // Freeze toolCalls and MCP together once the window is full: the two
          // rates must share one denominator, otherwise errRate and the MCP
          // board diverge after truncation.
          if (w.toolCalls >= windowLimit()) {
            w.truncated = true
            continue
          }
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
        const now = nowMs()
        const ttl = ttlMs()
        const expired = state.windows.filter((w) => now - w.lastActivityAt > ttl)
        if (expired.length > 0) {
          state.windows = state.windows.filter((w) => now - w.lastActivityAt <= ttl)
          for (const w of expired) persist(w, 'stale')
          if (state.windows.length === 0) return
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
  // Parallel windows share one model call: token amounts are split 1/N so two
  // skills open at once do not each bill the full call (the per-step total
  // keeps the full amount; only the per-window attribution is split).
  offs.push(
    ctx.on('session/event', (session: Host, event: Host) => {
      try {
        if (!event || typeof event.type !== 'string') return
        const sessionId = session && session.id ? String(session.id) : null
        if (!sessionId) return
        const data = event.data && typeof event.data === 'object' ? event.data : {}
        const meta = metaFor(sessionId)
        const state = sessions.get(sessionId)
        const windows = state?.windows ?? []
        const each = (fn: (w: LiveWindow) => void) => {
          for (const w of windows) fn(w)
        }

        switch (event.type) {
          case 'assistant/message': {
            if (config.countTokens !== false) {
              const usage = data.usage
              if (usage && typeof usage === 'object') {
                const step = stepStats.get(sessionId)
                if (step) {
                  step.tokens.input += Number(usage.inputTokens) || 0
                  step.tokens.output += Number(usage.outputTokens) || 0
                  step.tokens.cacheRead += Number(usage.cacheReadTokens) || 0
                  step.tokens.calls += 1
                }
                if (windows.length > 0) {
                  const share = 1 / windows.length
                  for (const w of windows) {
                    w.tokens.input += (Number(usage.inputTokens) || 0) * share
                    w.tokens.output += (Number(usage.outputTokens) || 0) * share
                    w.tokens.cacheRead += (Number(usage.cacheReadTokens) || 0) * share
                    w.tokens.calls += 1
                  }
                }
              }
            }
            const message = data.message && typeof data.message === 'object' ? data.message : null
            const source = message && message.source && typeof message.source === 'object' ? message.source : null
            const messageId =
              (message && typeof message.id === 'string' && message.id) ||
              (typeof data.messageId === 'string' ? data.messageId : null)
            if (messageId) {
              each((w) => {
                if (!w.messageIds.includes(messageId) && w.messageIds.length < 20) w.messageIds.push(messageId)
              })
            }
            if (source) {
              const provider = typeof source.provider === 'string' ? source.provider : null
              const model = typeof source.model === 'string' ? source.model : null
              if (provider || model) {
                each((w) => {
                  w.model = { ...w.model, ...(provider ? { provider } : {}), ...(model ? { model } : {}) }
                })
              }
            }
            break
          }
          case 'model/selection': {
            const model = {
              provider: typeof data.provider === 'string' ? data.provider : null,
              model: typeof data.model === 'string' ? data.model : null,
              effort:
                typeof data.reasoningEffort === 'string'
                  ? data.reasoningEffort
                  : typeof data.effort === 'string'
                    ? data.effort
                    : null,
            }
            meta.model = { ...meta.model, ...model }
            each((w) => {
              w.model = { ...w.model, ...model }
            })
            break
          }
          case 'agent-preset/selected': {
            const preset = typeof data.agentPreset === 'string' ? data.agentPreset : null
            if (preset) {
              meta.model = { ...meta.model, preset }
              each((w) => {
                w.model = { ...w.model, preset }
              })
            }
            break
          }
          case 'permission/preset': {
            const preset = typeof data.preset === 'string' ? data.preset : null
            meta.permissionPreset = preset
            each((w) => {
              w.context.permissionPreset = preset
            })
            break
          }
          case 'sandbox/mode': {
            const mode = typeof data.mode === 'string' ? data.mode : null
            meta.sandboxMode = mode
            each((w) => {
              w.context.sandboxMode = mode
            })
            break
          }
          case 'feedback/message-put': {
            const item = data.item && typeof data.item === 'object' ? data.item : null
            const messageId = item && typeof item.messageId === 'string' ? item.messageId : null
            if (!item || !messageId) break
            const rating = item.rating === 'positive' || item.rating === 'negative' ? item.rating : null
            if (!rating) break
            feedbackByMessage.set(`${sessionId}|${messageId}`, {
              rating,
              category: typeof item.category === 'string' ? item.category.slice(0, 40) : null,
              note: typeof item.note === 'string' && item.note.trim().length > 0 ? item.note.slice(0, 300) : null,
            })
            for (const w of windows) if (w.messageIds.includes(messageId)) refreshFeedback(w)
            break
          }
          case 'feedback/message-delete': {
            const messageId = typeof data.messageId === 'string' ? data.messageId : null
            if (!messageId) break
            feedbackByMessage.delete(`${sessionId}|${messageId}`)
            for (const w of windows) if (w.messageIds.includes(messageId)) refreshFeedback(w)
            break
          }
          case 'feedback/record': {
            const text = typeof data.text === 'string' ? data.text.trim() : ''
            const category = typeof data.category === 'string' ? data.category.slice(0, 40) : null
            if (!text && !category) break
            each((w) => {
              if (text && w.feedback.notes.length < 4) w.feedback.notes.push(noteText(text))
              if (category)
                w.feedback.categories[`session:${category}`] = (w.feedback.categories[`session:${category}`] ?? 0) + 1
            })
            break
          }
          case 'deliverables/presented':
            each((w) => {
              w.outcomes.deliverables += 1
            })
            break
          case 'workspace/changes':
            each((w) => {
              w.outcomes.workspaceChanges += 1
            })
            break
          case 'job/settled': {
            const failed = isFailure(failureStatus(data))
            each((w) => {
              if (failed) w.outcomes.jobsFailed += 1
              else w.outcomes.jobsSettled += 1
            })
            break
          }
          case 'team/task': {
            const task = data.task && typeof data.task === 'object' ? data.task : data
            const status = failureStatus(task)
            const completed = /complete|done|success/.test(status)
            const failed = isFailure(status)
            if (!completed && !failed) break
            each((w) => {
              if (failed) w.outcomes.tasksFailed += 1
              else w.outcomes.tasksCompleted += 1
            })
            break
          }
          case 'tool-workflow/run-end': {
            if (isFailure(failureStatus(data))) break
            each((w) => {
              w.outcomes.workflowRuns += 1
            })
            break
          }
          case 'approval/asked':
            each((w) => {
              w.approvals.asked += 1
            })
            break
          case 'approval/decided': {
            const rejected = isFailure(failureStatus(data))
            each((w) => {
              w.approvals.decided += 1
              if (rejected) w.approvals.rejected += 1
            })
            break
          }
          case 'compaction/start':
            each((w) => {
              w.context.compactions += 1
            })
            break
          default:
            break
        }
      } catch {
        // telemetry must never break the session
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
    async flush() {
      await store.queue
      if (pendingStatics.size > 0) await Promise.allSettled([...pendingStatics])
      await store.queue
    },
    async dispose() {
      for (const sessionId of [...stepStats.keys()]) flushStep(sessionId, 'dispose')
      for (const state of sessions.values()) closeWindows(state, 'dispose')
      sessions.clear()
      steps.clear()
      turns.clear()
      sessionMeta.clear()
      feedbackByMessage.clear()
      seenInvocations.clear()
      // let every queued write land before the caller tears the store down,
      // including the fire-and-forget static captures above
      if (pendingStatics.size > 0) await Promise.allSettled([...pendingStatics])
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
