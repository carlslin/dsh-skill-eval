#!/usr/bin/env node
/**
 * Post-restart acceptance for dsh-skill-eval.
 *
 *   node scripts/accept.mjs [baseUrl] [--data-dir <dir>]
 *
 * Exit code 0 = every automatic check passed. A non-zero exit prints the stale
 * hint: the running host is still serving an older plugin generation, so quit
 * and reopen DeepSeek Harness.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { runAcceptance } from '../lib/accept.js'
import { dashboardBase, expectedVersion, parseCliArgs, resolveBaseUrl } from './lib.mjs'

const args = process.argv.slice(2)
const parsedArgs = parseCliArgs(args)
const baseArg = parsedArgs.baseArg
const dataDirOverride = parsedArgs.values['--data-dir'] ? path.resolve(parsedArgs.values['--data-dir']) : null
const resolved = await resolveBaseUrl(baseArg)
const baseUrl = resolved.baseUrl
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const currentVersion = expectedVersion(manifest.version)
const version = typeof manifest.version === 'string' ? manifest.version : null

async function findDataDir() {
  if (dataDirOverride) return dataDirOverride
  const home = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  const root = path.join(home, 'skill-eval')
  let candidates
  try {
    candidates = await readdir(root)
  } catch {
    return null
  }
  let best = null
  for (const name of candidates) {
    const dir = path.join(root, name)
    try {
      const info = await stat(path.join(dir, 'events.jsonl'))
      if (!best || info.mtimeMs > best.mtimeMs) best = { dir, mtimeMs: info.mtimeMs }
    } catch {
      // no telemetry in this profile yet
    }
  }
  return best ? best.dir : null
}

function unreachable(url, cause) {
  const error = new Error(
    `${url} is unreachable (${cause && cause.code ? cause.code : cause && cause.message ? cause.message : 'fetch failed'})`,
  )
  error.unreachable = true
  return error
}

async function readJson(response, url) {
  const type = response.headers.get('content-type') || ''
  if (!type.includes('application/json')) {
    throw new Error(`${url} returned ${type || 'no content-type'} instead of JSON (route missing)`)
  }
  return response.json()
}

async function fetchReport() {
  const url = `${baseUrl}/skill-eval/data`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    let response
    try {
      response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    } catch (cause) {
      throw unreachable(url, cause)
    }
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    return await readJson(response, url)
  } finally {
    clearTimeout(timer)
  }
}

async function fetchVersioned() {
  if (!version) throw new Error('package version is unknown')
  const url = `${baseUrl}/skill-eval/data/${version}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    let response
    try {
      response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    } catch (cause) {
      throw unreachable(url, cause)
    }
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    return await readJson(response, url)
  } finally {
    clearTimeout(timer)
  }
}

const dashboard = dashboardBase()

async function fetchConfigPage() {
  const versioned = `${baseUrl}${dashboard}/board/${manifestVersion()}/config`
  const canonical = `${baseUrl}${dashboard}/config`
  const url = versioned
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    let response
    try {
      response = await fetch(url, { signal: controller.signal, headers: { accept: 'text/html' } })
    } catch (cause) {
      throw unreachable(url, cause)
    }
    if (response.status === 404) {
      const fallback = await fetch(canonical, { signal: controller.signal, headers: { accept: 'text/html' } })
      if (!fallback.ok) throw new Error(`${canonical} returned HTTP ${fallback.status}`)
      return await fallback.text()
    }
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    return await response.text()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchSettingsApi() {
  const url = `${baseUrl}${dashboard}/settings/${manifestVersion()}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)
  try {
    let response
    try {
      response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } })
    } catch (cause) {
      throw unreachable(url, cause)
    }
    if (response.status === 404) {
      const fallbackUrl = `${baseUrl}${dashboard}/settings`
      const fallback = await fetch(fallbackUrl, { signal: controller.signal, headers: { accept: 'application/json' } })
      if (!fallback.ok) throw new Error(`${fallbackUrl} returned HTTP ${fallback.status}`)
      return await readJson(fallback, fallbackUrl)
    }
    if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`)
    return await readJson(response, url)
  } finally {
    clearTimeout(timer)
  }
}

function manifestVersion() {
  return expectedVersion(currentVersion)
}

async function readFiles() {
  // The served report names the data directory it actually read; prefer it over
  // scanning profiles, which can pick a different profile with a newer mtime.
  let dataDir = dataDirOverride
  if (!dataDir) {
    try {
      const served = await fetchReport()
      if (served && typeof served.dataDir === 'string' && served.dataDir.length > 0) dataDir = served.dataDir
    } catch {
      // fall back to the profile scan below
    }
  }
  dataDir = dataDir ?? (await findDataDir())
  if (!dataDir) throw new Error('no skill-eval data directory found (has any skill been loaded yet?)')
  const eventsPath = path.join(dataDir, 'events.jsonl')
  const snapshotMarkdownPath = path.join(dataDir, 'reports', 'latest.md')
  const snapshotJsonPath = path.join(dataDir, 'reports', 'latest.json')
  const raw = await readFile(eventsPath, 'utf8')
  const events = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {
      // torn write
    }
  }
  const readOptional = async (file) => {
    try {
      return await readFile(file, 'utf8')
    } catch {
      return null
    }
  }
  return {
    eventsPath,
    snapshotMarkdownPath,
    snapshotJsonPath,
    events,
    snapshotText: await readOptional(snapshotMarkdownPath),
    snapshotJsonText: await readOptional(snapshotJsonPath),
  }
}

const report = await runAcceptance({
  baseUrl,
  fetchReport,
  fetchVersioned,
  fetchConfigPage,
  fetchSettingsApi,
  readFiles,
})

if (!baseUrl) {
  console.log('dsh-skill-eval acceptance: no base URL')
  console.log(`  pass one explicitly: node scripts/accept.mjs http://127.0.0.1:<port>`)
  console.log(`  or export DSH_WEB_URL (the GUI port changes on every launch)`)
  process.exit(1)
}

console.log(`dsh-skill-eval acceptance — ${baseUrl} (from ${resolved.source})`)
for (const item of report.results) {
  const mark = item.ok ? 'PASS' : 'FAIL'
  console.log(`  [${mark}] ${item.id.padEnd(18)} ${item.detail}`)
}
console.log('')
console.log(report.summary)
process.exit(report.ok ? 0 : 1)
