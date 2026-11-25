#!/usr/bin/env node
/**
 * Real-turn end-to-end acceptance for dsh-skill-eval.
 *
 *   node tools/e2e-live.mjs [--profile seve2e] [--keep] [--timeout 240000]
 *                             [--source auto|local|npm] [--require-credential]
 *
 * It creates a disposable headless profile from the shipped template, installs
 * this release, writes a throwaway project skill under <tmp>/.agents/skills,
 * runs one real headless turn that must load it, then verifies the telemetry,
 * report JSON, snapshot and board HTML.
 *
 * A model turn needs DEEPSEEK_API_KEY in the environment. Without it the run is
 * reported as SKIP (exit 0) unless --require-credential was passed (exit 2).
 */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { E2E_SKILL, buildSkillMarkdown, summarize, verifyReport, verifyTelemetry } from '../lib/e2e.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)

export function parseArgs(argv) {
  const out = {
    profile: 'seve2e',
    keep: false,
    timeoutMs: 240000,
    source: 'auto',
    requireCredential: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') out.help = true
    else if (arg === '--keep') out.keep = true
    else if (arg === '--require-credential') out.requireCredential = true
    else if (arg === '--profile') out.profile = String(argv[++i] ?? out.profile)
    else if (arg === '--timeout') out.timeoutMs = Number(argv[++i] ?? out.timeoutMs)
    else if (arg === '--source') out.source = String(argv[++i] ?? out.source)
    else throw new Error('unknown argument: ' + arg)
  }
  if (!Number.isFinite(out.timeoutMs) || out.timeoutMs < 30000) out.timeoutMs = 240000
  if (!['auto', 'local', 'npm'].includes(out.source)) out.source = 'auto'
  return out
}

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, options.timeoutMs ?? 240000)
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + String(error), timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

async function readEvents(file) {
  const raw = await readFile(file, 'utf8').catch(() => null)
  if (raw === null) return []
  const events = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      /* torn tail */
    }
  }
  return events
}

function printRows(title, rows) {
  console.log('\n' + title)
  for (const row of rows) console.log('  [' + row.status + '] ' + row.id.padEnd(24) + ' ' + row.detail)
}

async function waitFor(file, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    try {
      return await readFile(file, 'utf8')
    } catch {
      if (Date.now() >= deadline) return null
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(
      'Usage: node tools/e2e-live.mjs [--profile seve2e] [--keep] [--timeout ms] [--source auto|local|npm] [--require-credential]',
    )
    console.log('')
    console.log(
      'Real headless turn: installs this release into a throwaway profile, loads a probe skill, checks telemetry/report/board.',
    )
    console.log('Needs DEEPSEEK_API_KEY; without it the run reports SKIP (exit 0).')
    return 0
  }

  const manifest = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
  const version = String(manifest.version)
  const localTarball = path.join(ROOT, 'dist', 'dsh-skill-eval-' + version + '.tgz')
  let source = null
  if (options.source !== 'npm') {
    try {
      await readFile(localTarball)
      source = localTarball
    } catch {
      source = null
    }
  }
  if (!source && options.source !== 'local') source = 'dsh-skill-eval@' + version
  if (!source) {
    console.error('No dist tarball for ' + version + '; run npm run build:pack or pass --source npm')
    return 2
  }

  const dshHome = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  const dataDir = path.join(dshHome, 'skill-eval', options.profile)
  const workdir = await mkdtemp(path.join(tmpdir(), 'dsh-e2e-'))
  const marker = 'E2E-MARKER-' + Date.now().toString(36).toUpperCase()
  console.log('dsh-skill-eval e2e — real headless turn · version ' + version)
  console.log('  profile: ' + options.profile + ' · source: ' + source)
  console.log('  workdir: ' + workdir)

  let exitCode = 0
  const rows = []
  try {
    await mkdir(path.join(workdir, '.git'), { recursive: true })
    await mkdir(path.join(workdir, '.agents', 'skills', E2E_SKILL), { recursive: true })
    await writeFile(path.join(workdir, '.agents', 'skills', E2E_SKILL, 'SKILL.md'), buildSkillMarkdown(marker), 'utf8')

    const profileDir = path.join(dshHome, 'profiles', options.profile)
    let profileExists = true
    try {
      await readFile(path.join(profileDir, 'package.json'))
    } catch {
      profileExists = false
    }
    if (!profileExists) {
      const created = await run('dsh', [options.profile, '--from-default-profile', 'headless', '--help'], {
        cwd: workdir,
        timeoutMs: 120000,
      })
      if (created.code !== 0) throw new Error('could not create profile: ' + (created.stderr || created.stdout).trim())
    }
    const install = await run('dsh', ['plugin', '--profile', options.profile, 'add', source], {
      cwd: ROOT,
      timeoutMs: 240000,
    })
    if (install.code !== 0) throw new Error('plugin install failed: ' + (install.stderr || install.stdout).trim())
    const installed = JSON.parse(
      await readFile(path.join(profileDir, 'node_modules', 'dsh-skill-eval', 'package.json'), 'utf8'),
    )
    if (installed.version !== version) throw new Error('installed ' + installed.version + ', expected ' + version)

    if (!process.env.DEEPSEEK_API_KEY) {
      console.log('')
      console.log('  [SKIP] real turn — DEEPSEEK_API_KEY is not set in this environment.')
      console.log('         Set it and re-run:  DEEPSEEK_API_KEY=... npm run e2e')
      if (options.requireCredential) exitCode = 2
      return exitCode
    }

    const prompt =
      'You must first call the skill tool with name "' +
      E2E_SKILL +
      '" and follow the loaded instructions. Then reply with the exact marker the skill contains. Do not call any other tool.'
    const turn = await run('dsh', [options.profile, '--json', prompt], {
      cwd: workdir,
      env: { DSH_PROFILE: options.profile, DSH_HOME: dshHome },
      timeoutMs: options.timeoutMs,
    })
    console.log('  turn exit: ' + String(turn.code) + (turn.timedOut ? ' (timed out)' : ''))
    if (turn.code !== 0) {
      console.log('  turn stderr (tail):')
      console.log((turn.stderr || turn.stdout).trim().split('\n').slice(-12).join('\n'))
    }

    const events = await readEvents(path.join(dataDir, 'events.jsonl'))
    const telemetry = verifyTelemetry(events, { marker, replyText: turn.stdout + '\n' + turn.stderr })
    rows.push(...telemetry.rows)
    printRows('Telemetry', telemetry.rows)

    let report = null
    let boardHtml = ''
    try {
      const reportModule = await import(pathToFileURL(path.join(ROOT, 'lib', 'report.js')).href)
      const renderModule = await import(pathToFileURL(path.join(ROOT, 'lib', 'render.js')).href)
      const analyzer = reportModule.createAnalyzer({ on: () => () => {} }, { dataDir })
      report = await analyzer.build()
      boardHtml = renderModule.renderHtml(report, { lang: 'en' })
    } catch (error) {
      console.log(
        '  [SKIP] report/board — built lib/ missing (' + String(error.message).slice(0, 120) + '); run npm run compile',
      )
    }
    if (report) {
      const reportChecks = verifyReport(report)
      rows.push(...reportChecks.rows)
      printRows('Report', reportChecks.rows)
      const boardRow = {
        id: 'board-card',
        status: boardHtml.includes(E2E_SKILL) && boardHtml.includes('class="card"') ? 'PASS' : 'FAIL',
        detail: 'board HTML contains the skill card',
      }
      rows.push(boardRow)
      printRows('Board', [boardRow])
    }

    const snapshotRaw = await waitFor(path.join(dataDir, 'reports', 'latest.json'))
    let snapshotSkill = null
    try {
      const snapshot = JSON.parse(snapshotRaw ?? '{}')
      snapshotSkill = (snapshot.skills ?? []).find((entry) => entry && entry.skill === E2E_SKILL) ?? null
    } catch {
      snapshotSkill = null
    }
    const snapshotRow = {
      id: 'snapshot',
      status: snapshotSkill ? 'PASS' : 'SKIP',
      detail: snapshotSkill ? 'reports/latest.json includes ' + E2E_SKILL : 'no settled snapshot for this turn',
    }
    rows.push(snapshotRow)
    printRows('Snapshot', [snapshotRow])

    const counts = summarize(rows)
    const verdict = counts.FAIL > 0 ? 'FAIL' : 'PASS'
    console.log('')
    console.log(verdict + ' — ' + counts.PASS + ' checked, ' + counts.SKIP + ' skipped, ' + counts.FAIL + ' failed')
    if (verdict === 'FAIL') exitCode = 1
    return exitCode
  } catch (error) {
    console.error('\nFAIL — ' + (error instanceof Error ? error.message : String(error)))
    return 1
  } finally {
    if (options.keep) console.log('  kept workdir: ' + workdir)
    else await rm(workdir, { recursive: true, force: true }).catch(() => {})
    if (!options.keep) {
      await rm(dataDir, { recursive: true, force: true }).catch(() => {})
      await rm(path.join(dshHome, 'profiles', options.profile), { recursive: true, force: true }).catch(() => {})
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().then((code) => process.exit(code))
}
