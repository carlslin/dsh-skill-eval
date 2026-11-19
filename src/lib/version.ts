/** Running package version. Shared by routes (versioned alias), the dev view
 * (restart-skew detector) and the client payload (pages). */
import { existsSync, readFileSync } from 'node:fs'

/**
 * Emitted `index.js` sits next to package.json. `src/index.ts` is one directory
 * down, `src/lib/*.ts` two. Either layout has to find the same manifest, or
 * the versioned routes never register.
 */
export function manifestUrl(): URL {
  const candidates = [
    new URL('./package.json', import.meta.url),
    new URL('../package.json', import.meta.url),
    new URL('../../package.json', import.meta.url),
  ]
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // keep looking
    }
  }
  return candidates[candidates.length - 1]
}

/** The running package version (null when the manifest cannot be read). */
export function packageVersion(): string | null {
  try {
    const parsed = JSON.parse(readFileSync(manifestUrl(), 'utf8'))
    return typeof parsed.version === 'string' ? parsed.version : null
  } catch {
    return null
  }
}

export const PLUGIN_VERSION = packageVersion()
