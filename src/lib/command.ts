/**
 * `/skill-eval` slash-command dispatch. The keyword table moved out of
 * index.ts so the entry keeps only registration; the handler takes its
 * dependencies explicitly and returns the same `{ kind, text }` shape.
 */
import path from 'node:path'
import { checkInProcessReport } from './accept.ts'
import { acceptanceFiles, renderAcceptance, runReport, type ReportDiagnostics } from './tools.ts'
import { SETTINGS_FILE } from './settings.ts'
import type { Analyzer } from './report.ts'
import type { Host, Json } from './types.ts'

export interface CommandDeps {
  reportDir?: unknown
  settingsDir: string | null
  settingsKeys: string[]
  manifestUrl: () => URL
  moduleVersion: string | null
  diagnostics: ReportDiagnostics
}

export interface CommandResult {
  kind: 'success' | 'error'
  text: string
}

/** Split `/skill-eval <keyword> [rest]` into its keyword and remainder. */
export function parseSkillEvalInput(rawInput: string): { keyword: string; rest: string; target: string } {
  const target = String(rawInput ?? '').trim()
  const keyword = target.toLowerCase()
  if (keyword.startsWith('history ') || keyword.startsWith('impact ')) {
    const view = keyword.split(' ')[0]
    return { keyword: view, rest: target.slice(view.length + 1).trim(), target }
  }
  if (keyword.startsWith('loop ') || keyword.startsWith('loop\t')) {
    return { keyword: 'loop', rest: target.slice(4).trim(), target }
  }
  return { keyword, rest: '', target }
}

export async function handleSkillEvalCommand(
  analyzer: Analyzer,
  cfg: Record<string, unknown>,
  rawInput: string,
  deps: CommandDeps,
): Promise<CommandResult> {
  try {
    const { keyword, rest, target } = parseSkillEvalInput(rawInput)
    const reportDeps = {
      manifestUrl: deps.manifestUrl,
      moduleVersion: deps.moduleVersion,
      diagnostics: deps.diagnostics,
    }
    if (keyword === 'accept' || keyword === 'doctor') {
      const report = await analyzer.build()
      const files = await acceptanceFiles(
        analyzer.store,
        (file: string) => import('node:fs/promises').then((fs) => fs.readFile(file, 'utf8')),
        cfg.reportDir ? String(cfg.reportDir) : path.join(analyzer.store.dir, 'reports'),
      )
      const acceptance = checkInProcessReport(report, { version: deps.moduleVersion ?? 'unknown', files })
      return { kind: 'success', text: '\n' + renderAcceptance(acceptance) + '\n' }
    }
    if (keyword === 'history' || keyword === 'impact') {
      const text = await runReport(analyzer, { view: keyword, skill: rest }, cfg, reportDeps)
      return { kind: 'success', text: `\n${text}\n` }
    }
    if (keyword === 'config') {
      const lines = [
        '## 配置 / effective settings',
        '',
        `override file: \`${path.join(deps.settingsDir ?? '<unknown>', SETTINGS_FILE)}\``,
        '',
      ]
      for (const field of deps.settingsKeys) {
        const value = field
          .split('.')
          .reduce<unknown>((node, key) => (node == null ? undefined : (node as Json)[key]), cfg)
        lines.push(`- \`${field}\`: **${value === undefined ? '—' : String(value)}**`)
      }
      lines.push('', '浏览器里打开 `<dashboardPath>/config` 可直接修改（保存后立即生效）。')
      return { kind: 'success', text: `\n${lines.join('\n')}\n` }
    }
    if (keyword === 'turns' || keyword === 'boards') {
      const text = await runReport(analyzer, { view: 'turns' }, cfg, reportDeps)
      return { kind: 'success', text: `\n${text}\n` }
    }
    if (keyword === 'dev' || keyword === 'diagnostics') {
      const text = await runReport(analyzer, { view: 'dev' }, cfg, reportDeps)
      return { kind: 'success', text: `\n${text}\n` }
    }
    if (keyword === 'validity' || keyword === 'valid') {
      const text = await runReport(analyzer, { view: 'validity' }, cfg, reportDeps)
      return { kind: 'success', text: `\n${text}\n` }
    }
    if (keyword === 'loop') {
      if (rest.toLowerCase() === 'all') {
        const text = await runReport(analyzer, { view: 'loop', all: true }, cfg, reportDeps)
        return { kind: 'success', text: `\n${text}\n` }
      }
      const text = await runReport(analyzer, { view: 'loop', skill: rest || undefined }, cfg, reportDeps)
      return { kind: 'success', text: `\n${text}\n` }
    }
    const view = ['mcp', 'runs', 'standard'].includes(keyword) ? keyword : undefined
    const text = await runReport(analyzer, view ? { view } : { skill: target || undefined }, cfg, reportDeps)
    return { kind: 'success', text: `\n${text}\n` }
  } catch (error) {
    return {
      kind: 'error',
      text: `skill-eval failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** Host registration for the slash command (needs ctx for inject/effect). */
export function registerSkillEvalCommand(
  ctx: Host,
  analyzer: Analyzer,
  cfg: Record<string, unknown>,
  getDeps: () => CommandDeps,
): void {
  ctx.inject(['commands'], (c: Host) => {
    c.effect(() => {
      const dispose = c.commands.register({
        name: 'skill-eval',
        description: 'show the skill execution report (scores, grades and cited fixes)',
        input: { hint: '[skill-name]' },
        async handler(invocation: Host) {
          return handleSkillEvalCommand(analyzer, cfg, String(invocation.rawInput ?? '').trim(), getDeps())
        },
      })
      return () => {
        try {
          dispose()
        } catch {
          // teardown failures must not escape into the host
        }
      }
    }, 'skill-eval: command')
  })
}
