/** Shared plumbing for the terminal check scripts (accept / verify). */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { pickBaseUrl } from '../lib/accept.js'

/** The relay bridge the desktop app writes; missing/unreadable means "none". */
export async function readBridge() {
  const home = process.env.DSH_HOME || path.join(homedir(), '.dsh')
  try {
    return JSON.parse(await readFile(path.join(home, 'remote-web-ui-relay-bridge.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Parse CLI arguments for the terminal checks: flags that take a value must
 * consume their value instead of leaking it into the positional base URL.
 * Returns { baseArg, values } where values is keyed by the flag name.
 */
export function parseCliArgs(argv, flagsWithValues = ['--data-dir']) {
  const args = Array.isArray(argv) ? argv : []
  let baseArg = null
  const values = {}
  for (let i = 0; i < args.length; i += 1) {
    const arg = String(args[i])
    if (arg === '--') {
      const next = args[i + 1]
      if (next !== undefined && baseArg === null) baseArg = String(next)
      break
    }
    if (arg.startsWith('--') && arg.includes('=')) {
      const name = arg.slice(0, arg.indexOf('='))
      if (flagsWithValues.includes(name)) values[name] = arg.slice(name.length + 1)
      continue
    }
    if (flagsWithValues.includes(arg)) {
      const value = args[i + 1]
      if (value !== undefined) {
        values[arg] = String(value)
        i += 1
      }
      continue
    }
    if (arg.startsWith('--')) continue
    if (baseArg === null) baseArg = arg
  }
  return { baseArg, values }
}

/** Base URL precedence: explicit argument > DSH_WEB_URL > relay bridge. */
export async function resolveBaseUrl(explicit) {
  return pickBaseUrl(explicit, process.env.DSH_WEB_URL, await readBridge())
}

/** Dashboard base path (`DSH_SKILL_EVAL_BASE` overrides the default). */
export function dashboardBase() {
  return (process.env.DSH_SKILL_EVAL_BASE || '/skill-eval').replace(/\/$/, '')
}

/** Version that the check scripts expect the host to serve. */
export function expectedVersion(fallback) {
  return process.env.DSH_SKILL_EVAL_VERSION || fallback
}

/**
 * GET with a timeout and a content-type assertion. Returns `{body, type}` and
 * throws an error whose message names the URL, like the old inline helpers.
 */
export async function httpGet(base, pathname, { expectType, timeoutMs = 5000 } = {}) {
  const url = base + pathname
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const body = await response.text()
    const type = response.headers.get('content-type') || ''
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`)
    if (expectType && type.indexOf(expectType) === -1) {
      throw new Error(`${url} → ${type || 'no content-type'} (expected ${expectType})`)
    }
    return { body, type }
  } finally {
    clearTimeout(timer)
  }
}
