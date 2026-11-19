import { promises as fs } from 'node:fs'
import path from 'node:path'
import { formatTimestamp } from './html.ts'
import { renderSummaryMarkdown } from './render.ts'
import { ensurePrivateDir, writePrivateAtomic } from './store.ts'
import type { Analyzer, Report } from './report.ts'

type TurnKey = { sessionId?: unknown; turn?: unknown } | null | undefined
type TurnEntry = Report['turnLoads'][number]

/**
 * Writes an aggregated snapshot of the report to disk after a turn settles.
 *
 * This is the "result after every run" surface that costs nothing: it never
 * touches the model context, so it adds zero tokens to the user's conversation.
 * The snapshot is debounced because one turn can settle several windows.
 */
export function turnSlug(entry: TurnKey): string {
  const session = String(entry?.sessionId ?? 'session')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .slice(-40)
  const turn = Number.isFinite(entry?.turn) ? `t${entry?.turn}` : 'tunspecified'
  return `${session}-${turn}`
}

export interface TurnReportRow {
  file: string
  slug: string
  bytes: number
  at: number
  sessionId: string | null
  turn: number | null
  skills: string[]
  totals: unknown
}

/** List the per-turn boards newest first (best effort; a missing dir is empty). */
export async function listTurnReports(dir: string): Promise<TurnReportRow[]> {
  const turnsDir = path.join(dir, 'turns')
  let names: string[]
  try {
    names = await fs.readdir(turnsDir)
  } catch {
    return []
  }
  const rows: TurnReportRow[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = path.join(turnsDir, name)
    try {
      const info = await fs.stat(file)
      const report = JSON.parse(await fs.readFile(file, 'utf8'))
      const slug = name.replace(/\.json$/, '')
      // The slug carries the turn the board was written for; turnLoads[0] is
      // the global newest load and can belong to another session.
      const parsed = slug.match(/^(.*)-t(\d+|unspecified)$/)
      rows.push({
        file: name,
        slug,
        bytes: info.size,
        at: info.mtimeMs,
        sessionId: parsed ? parsed[1] : (report?.turnLoads?.[0]?.sessionId ?? null),
        turn: parsed && parsed[2] !== 'unspecified' ? Number(parsed[2]) : (report?.turnLoads?.[0]?.turn ?? null),
        skills: (report?.skills ?? []).slice(0, 4).map((skill: { skill: string }) => skill.skill),
        totals: report?.totals ?? null,
      })
    } catch {
      // skip unreadable or partial files
    }
  }
  return rows.sort((a, b) => b.at - a.at)
}

export function renderTurnReportsMarkdown(
  rows: readonly Partial<TurnReportRow>[] | null | undefined,
  { limit = 20 }: { limit?: number } = {},
): string {
  const lines = ['## Per-turn boards', '']
  if (!rows || rows.length === 0) {
    lines.push('No per-turn board written yet. One is written after each settled turn that loaded a skill.')
    return lines.join('\n')
  }
  lines.push('| written | session | turn | skills | size | file |')
  lines.push('|---|---|---|---|---|---|')
  for (const row of rows.slice(0, limit)) {
    const when = formatTimestamp(row.at)
    lines.push(
      `| ${when} | \`${String(row.sessionId ?? '?').slice(-8)}\` | ${row.turn ?? '—'} | ${(row.skills ?? []).join(', ') || '—'} | ${row.bytes}b | \`${row.file}\` |`,
    )
  }
  return lines.join('\n')
}

export function createSnapshots({
  analyzer,
  dir,
  debounceMs = 1500,
  log,
  enabled = true,
  turnReports = true,
  turnReportsKeep = 50,
}: {
  analyzer: Pick<Analyzer, 'build'>
  dir: string
  debounceMs?: number
  log?: (message: string) => void
  enabled?: boolean | (() => boolean)
  turnReports?: boolean | (() => boolean)
  turnReportsKeep?: number | (() => number)
}) {
  // Getters so a settings change applies without recreating the snapshotter.
  const latestEnabled = () => (typeof enabled === 'function' ? enabled() !== false : enabled !== false)
  const turnsEnabled = () => (typeof turnReports === 'function' ? turnReports() !== false : turnReports !== false)
  const keepCount = () => {
    const raw = typeof turnReportsKeep === 'function' ? turnReportsKeep() : turnReportsKeep
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  }
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let pending = false
  // Contexts of the turns that settled while the debounce was open. Keeping
  // them lets the writer label each board with its own turn instead of the
  // globally newest turn in the store (wrong under concurrent sessions).
  let pendingTurns: TurnKey[] = []
  let disposed = false

  const markdownPath = path.join(dir, 'latest.md')
  const jsonPath = path.join(dir, 'latest.json')

  // Same crash rule as settings: a torn snapshot would be read as missing.
  const writeAtomic = writePrivateAtomic

  function pickTurnEntries(report: Pick<Report, 'turnLoads'>, contexts: readonly TurnKey[]) {
    const entries = Array.isArray(report.turnLoads) ? report.turnLoads : []
    const newest = [...entries].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0]
    const picked: TurnEntry[] = []
    const seen = new Set<string>()
    const add = (entry: TurnEntry | null | undefined) => {
      if (!entry) return
      const slug = turnSlug(entry)
      if (seen.has(slug)) return
      seen.add(slug)
      picked.push(entry)
    }
    if (!Array.isArray(contexts) || contexts.length === 0) {
      add(newest)
      return picked
    }
    for (const context of contexts) {
      const hasKey = context && (context.sessionId || Number.isFinite(context.turn))
      if (!hasKey) {
        add(newest)
        continue
      }
      const rows = context.sessionId ? entries.filter((entry) => entry.sessionId === context.sessionId) : entries
      const match = Number.isFinite(context.turn)
        ? rows.find((entry) => entry.turn === context.turn)
        : [...rows].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0]
      // No matching load means this turn loaded no skill: do not overwrite a
      // different turn's board with it.
      add(match ?? null)
    }
    return picked
  }

  const renderMarkdown = (report: Report) =>
    renderSummaryMarkdown({
      ...report,
      skills: report.skills.map((skill) => ({
        ...skill,
        topAdvice: skill.topAdvice.slice(0, 3),
      })),
    }) + '\n'

  async function write(contexts: readonly TurnKey[] = []) {
    const writeLatest = latestEnabled()
    const writeTurns = turnsEnabled()
    if (!writeLatest && !writeTurns) return null
    const report = await analyzer.build()
    let markdown: string | null = null
    if (writeLatest) {
      await ensurePrivateDir(dir)
      await writeAtomic(jsonPath, JSON.stringify(report, null, 2))
      markdown = renderMarkdown(report)
      await writeAtomic(markdownPath, markdown)
    }

    // One board per settled turn: the "每次执行后结果在单独的看板" surface.
    if (writeTurns) {
      markdown = markdown ?? renderMarkdown(report)
      const turnEntries = pickTurnEntries(report, contexts)
      if (turnEntries.length > 0) {
        try {
          const turnsDir = path.join(dir, 'turns')
          await ensurePrivateDir(turnsDir)
          for (const turnEntry of turnEntries) {
            const slug = turnSlug(turnEntry)
            await writeAtomic(path.join(turnsDir, `${slug}.json`), JSON.stringify(report, null, 2))
            await writeAtomic(path.join(turnsDir, `${slug}.md`), markdown)
          }
          const keep = keepCount()
          if (keep > 0) {
            const files = (await fs.readdir(turnsDir)).filter((name) => name.endsWith('.json'))
            if (files.length > keep) {
              const withStats = await Promise.all(
                files.map(async (name) => ({ name, at: (await fs.stat(path.join(turnsDir, name))).mtimeMs })),
              )
              withStats.sort((a, b) => b.at - a.at)
              for (const stale of withStats.slice(keep)) {
                await fs.rm(path.join(turnsDir, stale.name), { force: true })
                await fs.rm(path.join(turnsDir, stale.name.replace(/\.json$/, '.md')), { force: true })
              }
            }
          }
        } catch (error) {
          log?.(`turn snapshot failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    return report
  }

  async function run(): Promise<void> {
    if (disposed) return Promise.resolve()
    if (running) {
      pending = true
      return running
    }
    const contexts = pendingTurns
    pendingTurns = []
    running = (async () => {
      try {
        await write(contexts)
      } catch (error) {
        log?.(`snapshot failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        running = null
        if (pending || pendingTurns.length > 0) {
          pending = false
          void request()
        }
      }
    })()
    return running
  }

  function request(context?: TurnKey): void {
    if (disposed) return
    if (turnsEnabled()) pendingTurns.push(context ?? null)
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      void run()
    }, debounceMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  return {
    request,
    writeNow: run,
    paths: { markdown: markdownPath, json: jsonPath },
    async dispose() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (running) await running
      const contexts = pendingTurns
      pendingTurns = []
      disposed = true
      try {
        await write(contexts)
      } catch (error) {
        log?.(`snapshot failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    },
  }
}
