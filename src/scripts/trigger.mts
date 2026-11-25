#!/usr/bin/env node
/**
 * Deterministic trigger audit for skills.
 *
 *   dsh-skill-eval-trigger --cases cases.json [--data-dir <dir>]
 *                          [--catalog catalog.json] [--threshold 1]
 *                          [--format markdown|json] [--out file]
 *
 * Each case is { prompt, expect: "skill-name" | null, name? }. The judge ranks
 * every skill's rendered catalog description against the prompt and reports
 * accuracy/precision/recall plus per-case results. Exit code 1 when any case
 * fails, so it can be used as a CI gate.
 */
import { readFile, writeFile } from 'node:fs/promises'
import process from 'node:process'
import { createAnalyzer } from '../lib/report.js'
import { judgeTriggers, type TriggerCase, type TriggerSkill } from '../lib/trigger.js'

interface Options {
  cases: string
  dataDir?: string
  catalog?: string
  threshold: number
  margin: number
  format: 'markdown' | 'json'
  out?: string
}

function parse(argv: string[]): Options {
  const out: Options = { cases: '', threshold: 1, margin: 0.5, format: 'markdown' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: dsh-skill-eval-trigger --cases <file> [--data-dir <dir>] [--catalog <file>] [--threshold <n>] [--margin <n>] [--format markdown|json] [--out <file>]',
      )
      process.exit(0)
    } else if (arg === '--cases') out.cases = String(argv[++i] ?? '')
    else if (arg === '--data-dir') out.dataDir = String(argv[++i] ?? '')
    else if (arg === '--catalog') out.catalog = String(argv[++i] ?? '')
    else if (arg === '--threshold') out.threshold = Number(argv[++i] ?? 1)
    else if (arg === '--margin') out.margin = Number(argv[++i] ?? 0.5)
    else if (arg === '--format') out.format = argv[++i] === 'json' ? 'json' : 'markdown'
    else if (arg === '--out') out.out = String(argv[++i] ?? '')
    else throw new Error('unknown argument: ' + arg)
  }
  if (!out.cases) throw new Error('--cases is required')
  return out
}

function parseCases(raw: string): TriggerCase[] {
  const value = JSON.parse(raw) as { cases?: unknown } | unknown[]
  const list = Array.isArray(value) ? value : Array.isArray(value.cases) ? value.cases : []
  if (list.length === 0) throw new Error('cases file has no cases')
  return list.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error('case ' + index + ' is not an object')
    const record = item as Record<string, unknown>
    if (typeof record.prompt !== 'string' || record.prompt.trim().length === 0) {
      throw new Error('case ' + index + ' has no prompt')
    }
    const expect = record.expect === null || record.expect === undefined ? null : String(record.expect)
    return { prompt: record.prompt.trim(), expect, name: typeof record.name === 'string' ? record.name : undefined }
  })
}

async function catalogFromReport(dataDir: string | undefined): Promise<TriggerSkill[]> {
  const analyzer = createAnalyzer({ on: () => () => {} }, dataDir ? { dataDir } : {})
  const report = await analyzer.build()
  return (report.skills ?? [])
    .map((entry) => {
      const quality = entry.staticQuality
      const description =
        (typeof quality?.catalogDescription === 'string' && quality.catalogDescription.trim()) ||
        (typeof quality?.description === 'string' && quality.description.trim()) ||
        ''
      return { name: entry.skill, description }
    })
    .filter((skill) => skill.description.length > 0)
}

function markdown(audit: ReturnType<typeof judgeTriggers>): string {
  const lines = ['# Trigger audit', '']
  lines.push(
    'cases ' +
      audit.results.length +
      ' · accuracy ' +
      audit.accuracy +
      ' · precision ' +
      String(audit.precision ?? '—') +
      ' · recall ' +
      String(audit.recall ?? '—') +
      ' · threshold ' +
      audit.threshold +
      ' · margin ' +
      audit.margin,
  )
  lines.push('')
  lines.push('| # | prompt | expect | predicted | score | pass |')
  lines.push('|---|---|---|---|---|---|')
  audit.results.forEach((result, index) => {
    lines.push(
      '| ' +
        (index + 1) +
        ' | ' +
        result.prompt.replace(/\|/g, '\\|').slice(0, 80) +
        ' | ' +
        String(result.expect ?? '—') +
        ' | ' +
        String(result.predicted ?? '—') +
        ' | ' +
        result.score +
        ' | ' +
        (result.pass ? 'PASS' : 'FAIL') +
        ' |',
    )
  })
  return lines.join('\n')
}

const options = parse(process.argv.slice(2))
const cases = parseCases(await readFile(options.cases, 'utf8'))
const skills = options.catalog
  ? (JSON.parse(await readFile(options.catalog, 'utf8')) as TriggerSkill[])
  : await catalogFromReport(options.dataDir)
if (skills.length === 0) throw new Error('no skills with a description to judge')
const audit = judgeTriggers(cases, skills, { threshold: options.threshold, margin: options.margin })
const text = options.format === 'json' ? JSON.stringify({ ...audit, skills }, null, 2) : markdown(audit)
if (options.out) {
  await writeFile(options.out, text + '\n', 'utf8')
  console.log('wrote ' + options.out)
} else {
  process.stdout.write(text + '\n')
}
process.exit(audit.results.every((result) => result.pass) ? 0 : 1)
