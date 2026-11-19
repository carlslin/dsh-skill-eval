/**
 * Generic bootstrap confidence-interval helper.
 *
 * The score is a point estimate over a handful of runs, so "88" and "88 ± 9"
 * are very different claims. Resampling the loads (with replacement) and
 * re-scoring gives an honest interval without assuming a distribution.
 *
 * Pure leaf module: no imports, so both report.ts and runs.ts can use it
 * without forming a cycle.
 */
import { mulberry32 } from './random.ts'

export interface Interval95 {
  level: number
  low: number
  high: number
  resamples: number
}

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function bootstrapCI<T>(
  samples: readonly T[] | null | undefined,
  compute: (draw: T[]) => unknown,
  options: { resamples?: number; seed?: number; level?: number } = {},
): Interval95 | null {
  const resamples = finite(options.resamples, 200)
  const seed = finite(options.seed, 1)
  if (!Array.isArray(samples) || samples.length < 2 || resamples <= 0) return null
  const random = mulberry32(seed)
  const totals: number[] = []
  for (let i = 0; i < resamples; i += 1) {
    const draw: T[] = []
    for (let j = 0; j < samples.length; j += 1) draw.push(samples[Math.floor(random() * samples.length)])
    const value = compute(draw)
    if (typeof value === 'number' && Number.isFinite(value)) totals.push(value)
  }
  if (totals.length < 20) return null
  totals.sort((a, b) => a - b)
  // Nearest-rank quantiles; floor the low end and ceil the high end so the
  // interval stays conservative after the 0.1 display rounding below.
  const at = (p: number) => totals[Math.min(totals.length - 1, Math.max(0, Math.ceil(p * totals.length) - 1))]
  const low = Math.floor(at(0.025) * 10) / 10
  const high = Math.ceil(at(0.975) * 10) / 10
  return {
    level: options.level ?? 0.95,
    low,
    high,
    resamples: totals.length,
  }
}
