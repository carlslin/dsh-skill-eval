/** Escape text for the few HTML strings built outside React. */
export function formatTimestamp(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const date = new Date(n)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Minimal Markdown cell escaping for agent-facing tool output. Skill names,
 * user corrections and load errors are untrusted (they can contain `|` that
 * breaks tables, backticks that break code spans, or newlines that inject
 * extra blocks into the model context). Call this on every interpolated
 * value that lands inside markdown — never on the surrounding syntax.
 */
export function escapeMdCell(value: unknown): string {
  return String(value ?? '')
    .replace(/`/g, "'")
    .replace(/\|/g, '｜')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 300)
}

/** Single-line rendering of untrusted free text inside markdown evidence. */
export function escapeMdInline(value: unknown, limit = 200): string {
  return String(value ?? '')
    .replace(/`/g, "'")
    .replace(/[\r\n]+/g, ' ')
    .slice(0, limit)
}
