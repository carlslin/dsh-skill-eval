/**
 * A deterministic trigger audit: given real user prompts with a labeled skill
 * (or "no skill"), rank every skill's catalog description and report whether
 * the expected skill wins. This is a lexical baseline, not an LLM judge; it is
 * deterministic, cheap enough for CI and makes trigger regressions visible.
 */

export interface TriggerCase {
  prompt: string
  /** Expected skill name, or null when no skill should be selected. */
  expect: string | null
  name?: string
}

export interface TriggerSkill {
  name: string
  description: string
  trigger?: string
  anti?: string
}

export interface TriggerCaseResult {
  prompt: string
  expect: string | null
  predicted: string | null
  score: number
  pass: boolean
  reason: string
}

export interface TriggerAudit {
  results: TriggerCaseResult[]
  accuracy: number
  precision: number | null
  recall: number | null
  positive: number
  negative: number
  threshold: number
  margin: number
}

const LATIN = /[a-z0-9][a-z0-9_+-]*/g
const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'has',
  'have',
  'how',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'not',
  'of',
  'on',
  'or',
  'should',
  'that',
  'the',
  'their',
  'them',
  'then',
  'this',
  'to',
  'use',
  'used',
  'using',
  'was',
  'what',
  'when',
  'which',
  'will',
  'with',
  'you',
  'your',
])

export function tokens(text: string): string[] {
  const lower = String(text ?? '').toLowerCase()
  const out = new Set<string>()
  for (const word of lower.match(LATIN) ?? []) {
    if (word.length >= 2 && !STOPWORDS.has(word)) out.add(word)
  }
  // Chinese has no spaces: two-character shingles approximate words and keep
  // the judge useful for mixed Chinese/English descriptions.
  const runs = lower.match(/[\u3400-\u9fff]+/g) ?? []
  for (const run of runs) {
    if (run.length === 1) out.add(run)
    for (let i = 0; i + 1 < run.length; i += 1) out.add(run.slice(i, i + 2))
  }
  return [...out]
}

function sentences(text: string): string[] {
  return String(text ?? '')
    .split(/[\n。！？.!?;；]+/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function triggerParts(description: string): { trigger: string; anti: string } {
  let trigger = ''
  let anti = ''
  for (const sentence of sentences(description)) {
    if (/do not use|don't use|not for|不适用|不要用|不要用于|勿用于/i.test(sentence)) anti += ' ' + sentence
    else if (/use when|when to use|triggers?|适用|适用于|当用户|用于|使用场景|触发/i.test(sentence))
      trigger += ' ' + sentence
  }
  return { trigger: trigger.trim(), anti: anti.trim() }
}

function idfOf(skills: readonly TriggerSkill[]): Map<string, number> {
  const df = new Map<string, number>()
  for (const skill of skills) {
    for (const token of new Set(tokens(skill.name + ' ' + skill.description))) {
      df.set(token, (df.get(token) ?? 0) + 1)
    }
  }
  const out = new Map<string, number>()
  for (const [token, count] of df) out.set(token, Math.log((skills.length + 1) / (count + 0.5)))
  return out
}

/** Rank every skill for one prompt. Returns the best skill and its weighted score. */
export function rankSkills(
  prompt: string,
  skills: readonly TriggerSkill[],
): { name: string; score: number; scores: Record<string, number> } {
  const promptTokens = new Set(tokens(prompt))
  const idf = idfOf(skills)
  const scores: Record<string, number> = Object.create(null)
  for (const skill of skills) {
    const parts = triggerParts(skill.description)
    const trigger = skill.trigger ?? parts.trigger
    const anti = skill.anti ?? parts.anti
    const body = tokens(skill.name + ' ' + skill.description)
    const triggerTokens = new Set(tokens(trigger))
    const antiTokens = new Set(tokens(anti))
    let score = 0
    for (const token of body) if (promptTokens.has(token)) score += idf.get(token) ?? 1
    for (const token of triggerTokens) if (promptTokens.has(token)) score += 1.5 * (idf.get(token) ?? 1)
    for (const token of antiTokens) if (promptTokens.has(token)) score -= 2 * (idf.get(token) ?? 1)
    scores[skill.name] = Math.round(Math.max(0, score) * 100) / 100
  }
  let name = ''
  let score = 0
  for (const [candidate, value] of Object.entries(scores)) {
    if (value > score || (value === score && name === '')) {
      name = candidate
      score = value
    }
  }
  return { name, score, scores }
}

export function judgeTriggers(
  cases: readonly TriggerCase[],
  skills: readonly TriggerSkill[],
  options: { threshold?: number; margin?: number } = {},
): TriggerAudit {
  const threshold = Number.isFinite(Number(options.threshold)) ? Number(options.threshold) : 1
  const margin = Number.isFinite(Number(options.margin)) ? Math.max(0, Number(options.margin)) : 0.5
  const results: TriggerCaseResult[] = cases.map((item) => {
    const ranking = rankSkills(item.prompt, skills)
    const ordered = Object.values(ranking.scores).sort((a, b) => b - a)
    const second = ordered.length > 1 ? ordered[1] : 0
    const predicted =
      ranking.score >= threshold && ranking.score - second >= margin && ranking.name !== '' ? ranking.name : null
    const pass = predicted === item.expect
    const reason =
      predicted === null
        ? 'no skill reached the threshold'
        : predicted === item.expect
          ? 'expected skill ranked first'
          : 'expected ' + String(item.expect) + ', ranked ' + predicted
    return {
      prompt: item.prompt,
      expect: item.expect,
      predicted,
      score: ranking.score,
      pass,
      reason,
    }
  })
  const positive = cases.filter((item) => item.expect !== null).length
  const negative = cases.length - positive
  const passed = results.filter((item) => item.pass).length
  const tp = results.filter((item) => item.expect !== null && item.predicted === item.expect).length
  const fp = results.filter((item) => item.expect === null && item.predicted !== null).length
  // Precision covers both false positives from negative cases and wrong
  // positive labels; recall is the positive-case hit rate.
  const precisionValue = tp + fp > 0 ? Math.round((tp / (tp + fp)) * 1000) / 1000 : null
  const recallValue = positive > 0 ? Math.round((tp / positive) * 1000) / 1000 : null
  return {
    results,
    accuracy: cases.length > 0 ? Math.round((passed / cases.length) * 1000) / 1000 : 0,
    precision: precisionValue,
    recall: recallValue,
    positive,
    negative,
    threshold: Math.max(0, threshold),
    margin,
  }
}
