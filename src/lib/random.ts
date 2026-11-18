/** Small deterministic helpers shared by scoring and reporting. */

/** FNV-1a 32-bit hash; used to derive reproducible bootstrap seeds. */
export function hashSeed(text: unknown): number {
  let hash = 2166136261
  const value = typeof text === 'string' ? text : String(text ?? '')
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** Stable short hex hash for a diff, so the ledger can identify it without storing it. */
export function hashHex(text: unknown): string {
  return hashSeed(text).toString(16).padStart(8, '0')
}

/** Mulberry32 PRNG: deterministic, tiny, good enough for bootstrap resampling. */
export function mulberry32(seed: number): () => number {
  let a = (Number.isFinite(seed) ? seed : 1) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
