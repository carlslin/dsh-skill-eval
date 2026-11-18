/**
 * Reference integrity: a skill that promises `references/forms.md` or
 * `scripts/build.py` must ship those files. Broken promises are the most
 * common "the skill told me to read a file that does not exist" failure, and
 * they are cheap to check at load time (we already know the base directory).
 */

const REFERENCE_PATTERN = /(?:references\/[A-Za-z0-9._\-/]+|scripts\/[A-Za-z0-9._\-/]+|assets\/[A-Za-z0-9._\-/]+)/g

/** All repo-relative paths the body points at, deduplicated and bounded. */
export function referencedPaths(content: unknown, limit = 40): string[] {
  if (typeof content !== 'string' || content.length === 0) return []
  const found = new Set<string>()
  for (const match of content.matchAll(REFERENCE_PATTERN)) {
    const path = match[0].replace(/[.,;:)）】"'`]+$/, '')
    if (path.includes('..')) continue
    found.add(path)
    if (found.size >= limit) break
  }
  return [...found]
}

/**
 * Check the referenced paths against the skill directory.
 *
 * @param {{baseDir?: string|null, content?: string, stat?: Function}} input
 *   `stat` is injected so the check stays testable (and the plugin can keep it
 *   best-effort in a host without fs access).
 * @returns {Promise<{checked: number, missing: string[], ok: boolean}|null>}
 */
export async function checkReferences({
  baseDir,
  content,
  stat,
}: { baseDir?: string | null; content?: unknown; stat?: (file: string) => Promise<unknown> } = {}): Promise<{
  checked: number
  missing: string[]
  ok: boolean
} | null> {
  const paths = referencedPaths(content)
  if (paths.length === 0) return { checked: 0, missing: [], ok: true }
  if (typeof baseDir !== 'string' || baseDir.length === 0) return null
  if (typeof stat !== 'function') return null
  const missing: string[] = []
  for (const relative of paths) {
    const absolute = `${baseDir.replace(/\/$/, '')}/${relative}`
    try {
      await stat(absolute)
    } catch {
      missing.push(relative)
    }
  }
  return { checked: paths.length, missing: missing.slice(0, 20), ok: missing.length === 0 }
}
