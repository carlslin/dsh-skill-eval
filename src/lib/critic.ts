/**
 * Leakage critic for proposed skill edits (borrowed from RRSI's selection side).
 *
 * RRSI screens a candidate harness edit *before* it is scored: task names,
 * entities, answers and benchmark-specific logic are rejected so the evolver
 * cannot memorise the evaluation set. A skill body has the same failure mode —
 * a fix that hardcodes yesterday's task is not a reusable mechanism.
 *
 * This module is pure: it classifies a proposed diff/hypothesis and returns a
 * verdict. Nothing is applied here.
 */

interface LeakRule {
  code: string
  severity: 'reject' | 'warn'
  label: string
  pattern: RegExp | null
  detail: string
}

const RULES: LeakRule[] = [
  {
    code: 'hardcoded-answer',
    severity: 'reject',
    label: 'hardcoded answer or expected output',
    pattern: /\b(expected output|correct answer|the answer is|答案(?:是|为)|正确结果)\b/i,
    detail: 'a skill must derive its output, not embed one',
  },
  {
    code: 'task-specific-id',
    severity: 'reject',
    label: 'task-specific identifier',
    pattern: /\b(task[-_ ]?id|benchmark|eval[-_ ]?set|case[-_ ]?#?\d+|task\s*#\d+)\b/i,
    detail: 'references a single evaluation instance',
  },
  {
    code: 'hardcoded-date',
    severity: 'warn',
    label: 'hardcoded date or version window',
    pattern: /\b(20\d{2}-\d{2}-\d{2}|before 20\d{2}|after 20\d{2}|until 20\d{2})\b/,
    detail: 'date windows rot; keep them in config instead of the skill body',
  },
  {
    code: 'user-specific-path',
    severity: 'warn',
    label: 'absolute machine-specific path',
    pattern: /(?:\/Users\/[^/\s]+\/|\/home\/[^/\s]+\/|[A-Za-z]:\\Users\\)/,
    detail: 'a shared skill must not depend on one machine layout',
  },
  {
    code: 'benchmark-name',
    severity: 'reject',
    label: 'named benchmark or leaderboard',
    pattern: /\b(swe-?bench|terminal-?bench|harvey|gdpval|apex-?agents|jobbench|frontier-?eng|engdesign)\b/i,
    detail: 'optimising for a named benchmark is leakage, not capability',
  },
  {
    code: 'silent-overfit',
    severity: 'warn',
    label: 'special-casing on input shape',
    pattern: /\b(if (the )?(input|request|file) (is|looks like|matches)|when (the )?(input|file) is named)\b/i,
    detail: 'branching on the exact input shape generalises poorly',
  },
  {
    code: 'no-hypothesis',
    severity: 'warn',
    label: 'no falsifiable hypothesis',
    pattern: null,
    detail: 'state what should improve and how it will be measured (RRSI ledger)',
  },
]

export const LEAK_RULES = RULES

/**
 * Classify one proposed skill edit.
 *
 * @param {{skill?: string, diff?: string, hypothesis?: string}} input
 * @returns {{verdict: 'accept'|'warn'|'reject', reasons: Array<{code:string,severity:string,label:string,detail:string}>}}
 */
export function reviewSkillEdit(input: { skill?: unknown; diff?: unknown; hypothesis?: unknown } = {}): {
  verdict: 'accept' | 'warn' | 'reject'
  reasons: Array<{ code: string; severity: string; label: string; detail: string }>
} {
  const text = [input.diff, input.hypothesis].filter((part) => typeof part === 'string' && part.length > 0).join('\n')
  const reasons: Array<{ code: string; severity: string; label: string; detail: string }> = []
  if (text.length === 0) {
    reasons.push({
      code: 'empty-edit',
      severity: 'reject',
      label: 'nothing to review',
      detail: 'pass the proposed diff or at least a hypothesis',
    })
  }
  for (const rule of RULES) {
    if (rule.code === 'no-hypothesis') {
      if (typeof input.hypothesis !== 'string' || input.hypothesis.trim().length === 0) {
        reasons.push({ code: rule.code, severity: rule.severity, label: rule.label, detail: rule.detail })
      }
      continue
    }
    if (rule.pattern && rule.pattern.test(text)) {
      reasons.push({ code: rule.code, severity: rule.severity, label: rule.label, detail: rule.detail })
    }
  }
  const verdict = reasons.some((reason) => reason.severity === 'reject')
    ? 'reject'
    : reasons.length > 0
      ? 'warn'
      : 'accept'
  return { verdict, reasons }
}
