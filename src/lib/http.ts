/**
 * HTTP plumbing for the web dashboard, the JSON data route and the settings
 * API. Stateless helpers live here so src/index.ts only wires them to the
 * analyzer/config; nothing in this module touches host state directly.
 */
import type { Host, Json } from './types.ts'

export function statusOf(error: unknown): unknown {
  return error && typeof error === 'object' ? (error as { statusCode?: unknown }).statusCode : undefined
}

/** Validate the dashboard base path; fall back loudly on operator typos. */
export function normalizeBasePath(
  raw: unknown,
  fallback = '/skill-eval',
  onWarn: (message: string) => void = () => {},
): string {
  let base = String(raw || fallback).replace(/\/$/, '')
  if (!base.startsWith('/')) {
    onWarn(`skill-eval dashboardPath must start with '/': ${JSON.stringify(base)} — falling back to ${fallback}`)
    base = fallback
  }
  return base || fallback
}

export function hostnameOf(value: unknown): string {
  try {
    return new URL(String(value).includes('://') ? String(value) : 'http://' + String(value)).hostname.toLowerCase()
  } catch {
    return ''
  }
}

export interface OriginGate {
  rememberOrigin: (webServer: Host) => void
  trustedWrite: (req: Host, options?: { requireHeader?: boolean }) => boolean
  trustedRead: (req: Host) => boolean
}

/**
 * Same-origin fence for plugin routes. Comparing Origin to Host alone does not
 * stop DNS rebinding (both are the attacker's domain after rebinding), so the
 * Host itself must be the server's own origin or a loopback name. Reads carry
 * user correction text, so cross-site reads are rejected too — the panel
 * fetch is same-origin and unaffected.
 */
export function createOriginGate(): OriginGate {
  let serverOrigin: string | null = null
  const allowedWriteHosts = () => {
    const hosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])
    const own = serverOrigin ? hostnameOf(serverOrigin) : ''
    if (own) hosts.add(own)
    return hosts
  }
  return {
    rememberOrigin(webServer: Host) {
      try {
        const value = webServer.getOrigin()
        if (typeof value === 'string' && value) serverOrigin = value
      } catch {
        // keep the loopback fallback
      }
    },
    trustedWrite(req: Host, { requireHeader = false }: { requireHeader?: boolean } = {}) {
      const site = String(req.headers?.['sec-fetch-site'] ?? '').toLowerCase()
      if (site === 'cross-site') return false
      const host = String(req.headers?.['host'] ?? '')
      if (!allowedWriteHosts().has(hostnameOf(host))) return false
      const origin = req.headers?.origin
      if (origin) {
        try {
          const parsed = new URL(origin)
          if (parsed.host !== host) return false
        } catch {
          return false
        }
      }
      if (requireHeader && req.headers?.['x-skill-eval-config'] !== '1') return false
      return true
    },
    trustedRead(req: Host): boolean {
      const site = String(req.headers?.['sec-fetch-site'] ?? '').toLowerCase()
      if (site === 'cross-site') return false
      return true
    },
  }
}

export function bodyTooLarge(): Error & { statusCode: number } {
  return Object.assign(new Error('request body too large'), { statusCode: 413 })
}

/** Bounded body reader (64 KB default); rejects oversized streams mid-flight. */
export function readBody(req: Host, limit = 64 * 1024): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const declared = Number(req.headers?.['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      reject(bodyTooLarge())
      return
    }
    let body = ''
    let size = 0
    let settled = false
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      reject(error)
      if (typeof req.resume === 'function') req.resume()
    }
    if (typeof req.setEncoding === 'function') req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      if (settled) return
      size += Buffer.byteLength(chunk)
      if (size > limit) {
        fail(bodyTooLarge())
        return
      }
      body += chunk
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(body)
    })
    req.on('error', (error: unknown) => fail(error))
  })
}

/** Read `?lang=` from a raw request URL without needing an origin. */
export function requestLang(req: Host): string | null {
  const raw = typeof req?.url === 'string' ? req.url : ''
  const index = raw.indexOf('?')
  if (index === -1) return null
  try {
    return new URLSearchParams(raw.slice(index + 1)).get('lang')
  } catch {
    return null
  }
}

/** Parse a settings-API body: JSON first, urlencoded form as fallback. */
export async function readJsonBody(req: Host, read: (req: Host) => Promise<string> = readBody): Promise<Json> {
  const raw = await read(req)
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return Object.fromEntries(new URLSearchParams(raw))
  }
}

/**
 * The settings form only submits changed fields, so merge the patch over the
 * live config before checking the sum — otherwise saving a single weight
 * always fails the "positive total" gate.
 */
export function effectiveWeightError(
  values: Record<string, unknown>,
  baseWeights: Record<string, unknown> = {},
): { key: string; message: string } | null {
  const weights: Record<string, unknown> = { ...baseWeights }
  for (const [key, value] of Object.entries(values ?? {})) {
    if (key.startsWith('weights.')) weights[key.slice('weights.'.length)] = value
  }
  const sum = ['static', 'reliability', 'effectiveness', 'efficiency'].reduce(
    (total, dimension) => total + (Number(weights[dimension]) || 0),
    0,
  )
  return sum > 0 ? null : { key: 'weights.total', message: 'weights sum must be positive' }
}

/** Current effective value for one settings key, from a config-shaped object. */
export function settingsValue(cfg: Json, key: string): unknown {
  const [head, leaf] = key.split('.')
  const top = (cfg as Json)?.[head]
  const raw = leaf ? top?.[leaf] : top
  return raw === undefined ? null : raw
}

export interface SettingsFieldView {
  key: string
  label?: string
  labelZh?: string
  value?: unknown
  [extra: string]: unknown
}

/** Payload for the native config page: fields with live values + version. */
export function buildSettingsPayload<T extends { key: string; label?: string }>(
  fields: readonly T[],
  fieldZh: Record<string, string>,
  cfg: Json,
  version: string | null,
): { fields: (T & SettingsFieldView)[]; values: Record<string, unknown>; version: string | null } {
  const withValues: (T & SettingsFieldView)[] = fields.map((field) => ({
    ...field,
    labelZh: fieldZh[field.key] ?? field.label,
    value: settingsValue(cfg, field.key),
  }))
  return {
    fields: withValues,
    values: Object.fromEntries(withValues.map((field) => [field.key, settingsValue(cfg, field.key)])),
    version,
  }
}
