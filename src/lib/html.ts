/** Escape text for the few HTML strings built outside React. */
/** Format a finite epoch-ms timestamp, or an em dash when it is not a valid date. */
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
}
