#!/usr/bin/env node
/**
 * One-command build for dsh-skill-eval.
 *
 *   node scripts/build.mjs                 # format check, lint, typecheck, compile, doctor, tests
 *   node scripts/build.mjs --fast          # compile + doctor only
 *   node scripts/build.mjs --pack          # full checks + dist/<version>.tgz + doctor --release
 *   node scripts/build.mjs --install       # pack + install into the desktop profile
 *   node scripts/build.mjs --install=name  # pack + install into another DSH profile
 *   node scripts/build.mjs --fix           # prettier --write before the checks
 *
 * The script is intentionally dependency-free and uses the same commands the
 * release checklist documents, so a local build and CI cannot drift.
 */
import { spawnSync } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
const has = (flag: string) => args.includes(flag)
const valueOf = (flag: string) => {
  const match = args.find((arg) => arg === flag || arg.startsWith(`${flag}=`))
  if (!match) return null
  return match.includes('=') ? match.slice(match.indexOf('=') + 1) : ''
}

const fix = has('--fix')
const fast = has('--fast')
const installArg = valueOf('--install')
const doInstall = installArg !== null
const doPack = has('--pack') || doInstall
const profile = installArg || 'desktop'

function run(label: string, command: string, commandArgs: string[]) {
  console.log(`\n▶ ${label}`)
  const result = spawnSync(command, commandArgs, { cwd: root, stdio: 'inherit', env: process.env })
  if (result.error) {
    console.error(`\n✖ ${label} could not start: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    console.error(`\n✖ ${label} failed with exit code ${result.status ?? 'unknown'}`)
    process.exit(result.status ?? 1)
  }
}

function npm(script: string) {
  run(`npm run ${script}`, 'npm', ['run', script])
}

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
console.log(`dsh-skill-eval ${manifest.version} · ${fast ? 'fast build' : 'full build'}${doPack ? ' + pack' : ''}`)

if (fix) npm('format')
if (!fast) {
  npm('format:check')
  npm('lint')
  npm('typecheck')
}
npm('compile')
run('doctor', process.execPath, [path.join(root, 'scripts/doctor.mjs')])
if (!fast) run('tests', process.execPath, ['--experimental-strip-types', '--test', 'test/**/*.test.ts'])

let tarball: string | null = null
if (doPack) {
  npm('release:pack')
  tarball = path.join(root, 'dist', `dsh-skill-eval-${manifest.version}.tgz`)
  const info = await stat(tarball).catch(() => null)
  if (!info) {
    console.error(`\n✖ packed tarball not found: ${path.relative(root, tarball)}`)
    process.exit(1)
  }
  run('doctor --release', process.execPath, [path.join(root, 'scripts/doctor.mjs'), '--release'])
  console.log(`\n✔ artifact ${path.relative(root, tarball)} · ${Math.round(info.size / 1024)} kB`)
  if (doInstall) run(`install into ${profile}`, 'dsh', ['plugin', '--profile', profile, 'add', tarball])
}

console.log(
  `\n✔ build complete${tarball ? ` · ${path.relative(root, tarball)}` : ''}${doInstall ? ` · installed into ${profile}` : ''}`,
)
