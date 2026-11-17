import { promises as fs } from 'node:fs'
import path from 'node:path'
import { renderSummaryMarkdown } from './render.js'

/**
 * Writes an aggregated snapshot of the report to disk after a turn settles.
 *
 * This is the "result after every run" surface that costs nothing: it never
 * touches the model context, so it adds zero tokens to the user's conversation.
 * The snapshot is debounced because one turn can settle several windows.
 */
export function turnSlug(entry) {
  const session = String(entry?.sessionId ?? 'session')
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .slice(-40)
  const turn = Number.isFinite(entry?.turn) ? `t${entry.turn}` : 'tunspecified'
  return `${session}-${turn}`
}

/** List the per-turn boards newest first (best effort; a missing dir is empty). */
export async function listTurnReports(dir) {
  const turnsDir = path.join(dir, 'turns')
  let names
  try {
    names = await fs.readdir(turnsDir)
  } catch {
    return []
  }
  const rows = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const file = path.join(turnsDir, name)
    try {
      const info = await fs.stat(file)
      const report = JSON.parse(await fs.readFile(file, 'utf8'))
      rows.push({
        file: name,
        slug: name.replace(/\.json$/, ''),
        bytes: info.size,
        at: info.mtimeMs,
        sessionId: report?.turnLoads?.[0]?.sessionId ?? null,
        turn: report?.turnLoads?.[0]?.turn ?? null,
        skills: (report?.skills ?? []).slice(0, 4).map((skill) => skill.skill),
        totals: report?.totals ?? null,
      })
    } catch {
      // skip unreadable or partial files
    }
  }
  return rows.sort((a, b) => b.at - a.at)
}

export function renderTurnReportsMarkdown(rows, { limit = 20 } = {}) {
  const lines = ['## Per-turn boards', '']
  if (!rows || rows.length === 0) {
    lines.push('No per-turn board written yet. One is written after each settled turn that loaded a skill.')
    return lines.join('\n')
  }
  lines.push('| written | session | turn | skills | size | file |')
  lines.push('|---|---|---|---|---|---|')
  for (const row of rows.slice(0, limit)) {
    const when = new Date(row.at).toISOString().replace('T', ' ').slice(0, 19)
    lines.push(
      `| ${when} | \`${String(row.sessionId ?? '?').slice(-8)}\` | ${row.turn ?? '—'} | ${(row.skills ?? []).join(', ') || '—'} | ${row.bytes}b | \`${row.file}\` |`,
    )
  }
  return lines.join('\n')
}

export function createSnapshots({ analyzer, dir, debounceMs = 1500, log, turnReports = true, turnReportsKeep = 50 }) {
  let timer = null
  let running = null
  let pending = false

  const markdownPath = path.join(dir, 'latest.md')
  const jsonPath = path.join(dir, 'latest.json')

  async function write() {
    const report = await analyzer.build()
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8')
    const markdown =
      renderSummaryMarkdown({
        ...report,
        skills: report.skills.map((skill) => ({
          ...skill,
          topAdvice: skill.topAdvice.slice(0, 3),
        })),
      }) + '\n'
    await fs.writeFile(markdownPath, markdown, 'utf8')

    // One board per settled turn: the "每次执行后结果在单独的看板" surface.
    if (turnReports) {
      const turnEntry = [...(report.turnLoads ?? [])].sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))[0]
      if (turnEntry) {
        try {
          const turnsDir = path.join(dir, 'turns')
          await fs.mkdir(turnsDir, { recursive: true })
          const slug = turnSlug(turnEntry)
          await fs.writeFile(path.join(turnsDir, `${slug}.json`), JSON.stringify(report, null, 2), 'utf8')
          await fs.writeFile(path.join(turnsDir, `${slug}.md`), markdown, 'utf8')
          if (turnReportsKeep > 0) {
            const files = (await fs.readdir(turnsDir)).filter((name) => name.endsWith('.json'))
            if (files.length > turnReportsKeep) {
              const withStats = await Promise.all(
                files.map(async (name) => ({ name, at: (await fs.stat(path.join(turnsDir, name))).mtimeMs })),
              )
              withStats.sort((a, b) => b.at - a.at)
              for (const stale of withStats.slice(turnReportsKeep)) {
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

  async function run() {
    if (running) {
      pending = true
      return running
    }
    running = (async () => {
      try {
        await write()
      } catch (error) {
        log?.(`snapshot failed: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        running = null
        if (pending) {
          pending = false
          void request()
        }
      }
    })()
    return running
  }

  function request() {
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
      await run()
    },
  }
}
