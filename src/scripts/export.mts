#!/usr/bin/env node
/**
 * Export the current skill-eval report as JSON or spreadsheet-friendly CSV.
 *
 *   node scripts/export.mjs [--data-dir <dir>] [--format json|csv] [--out <file>]
 *
 * Without --out the document is written to stdout, so it composes with jq and
 * ordinary shell pipelines.
 */
import { writeFile } from 'node:fs/promises'
import process from 'node:process'
import { toCsv } from '../lib/export.js'
import { createAnalyzer } from '../lib/report.js'

function parse(argv: string[]) {
  const out: { dataDir?: string; format: 'json' | 'csv'; out?: string } = { format: 'csv' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--data-dir') out.dataDir = argv[++i]
    else if (arg === '--format') out.format = argv[++i] === 'json' ? 'json' : 'csv'
    else if (arg === '--out') out.out = argv[++i]
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: dsh-skill-eval-export [--data-dir <dir>] [--format json|csv] [--out <file>]')
      process.exit(0)
    } else throw new Error('unknown argument: ' + arg)
  }
  return out
}

const options = parse(process.argv.slice(2))
const analyzer = createAnalyzer({ on: () => () => {} }, options.dataDir ? { dataDir: options.dataDir } : {})
const report = await analyzer.build()
const text = options.format === 'json' ? JSON.stringify(report, null, 2) : toCsv(report)
if (options.out) {
  await writeFile(options.out, text + '\n', 'utf8')
  console.log('wrote ' + options.out + ' (' + report.skills.length + ' skill(s))')
} else {
  process.stdout.write(text + '\n')
}
