// Chinese copy for rule-generated advice (host attaches titleZh/fixZh).
const adviceView = <T extends Partial<Advice> | null | undefined>(item: T, lang: string): T =>
  item && lang === 'zh' && item.titleZh ? { ...item, title: item.titleZh, fix: item.fixZh || item.fix } : item

// Copy JSON/markdown for the agent. The async Clipboard API needs a real
// user gesture and can be missing on plain-http hosts, so fall back to the
// hidden-textarea + execCommand path before reporting failure.
async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the execCommand path
  }
  try {
    if (typeof document !== 'undefined' && typeof document.execCommand === 'function') {
      const area = document.createElement('textarea')
      area.value = text
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.top = '-1000px'
      area.style.opacity = '0'
      document.body.appendChild(area)
      try {
        area.select()
        return Boolean(document.execCommand('copy'))
      } finally {
        area.remove()
      }
    }
  } catch {
    // no clipboard available
  }
  return false
}

// One issue as a self-contained markdown task, so it can be pasted into a
// fresh agent session and fixed without the rest of the report.
function issueMarkdown(item: Partial<Advice>, target: string, t: Texts): string {
  const lines = [`## ${t.issueFixPrefix} ${target}: ${item.title}`, '']
  if (item.severity) lines.push(`- ${t.issueSeverity}: ${item.severity}`)
  if (item.id) lines.push(`- ${t.issueRule}: \`${item.id}\``)
  if (item.evidence) lines.push(`- ${t.issueEvidence}: ${item.evidence}`)
  if (item.fix) lines.push(`- ${t.issueFix}: ${item.fix}`)
  return lines.join('\n') + '\n'
}

const skillSeverityIcon = (severity: unknown) =>
  severity === 'critical' ? '🛑 ' : severity === 'warning' ? '⚠️ ' : 'ℹ️ '

const mdInline = (value: unknown) =>
  String(value ?? '')
    .replace(/`/g, "'")
    .replace(/[\r\n]+/g, ' ')
    .trim()

// One skill's displayed issues as a self-contained markdown task. The card
// already shows the budget-limited top problems; copying the same set keeps the
// handoff aligned with what the user sees and with the edit budget.
function skillIssuesMarkdown(skill: SkillData, t: Texts, lang: string): string {
  const score: NonNullable<SkillData['score']> = skill.score || {}
  const dims: NonNullable<typeof score.dimensions> = score.dimensions || {}
  const stats: NonNullable<SkillData['stats']> = skill.stats || {}
  const advice = (skill.topAdvice && skill.topAdvice.length ? skill.topAdvice : skill.advice || []).slice(0, 3)
  const lines = [
    `## ${t.skillFixHeading} \`${mdInline(skill.skill)}\`: ${fmt(score.total)}/100 (${score.grade || '?'})`,
    '',
    `- ${t.skillScore}: ${fmt(score.total)}/100 (${score.grade || '?'})${score.provisional ? ' · ' + t.provisional : ''}`,
  ]
  if (score.ci) lines.push(`- 95% CI: ${fmt(score.ci.low)} – ${fmt(score.ci.high)} · n=${score.samples || 0}`)
  lines.push(
    `- ${t.skillDimensions}: ${t.dims.static} ${fmt(dims.static)} · ${t.dims.reliability} ${fmt(dims.reliability)} · ${t.dims.effectiveness} ${fmt(dims.effectiveness)} · ${t.dims.efficiency} ${fmt(dims.efficiency)}`,
  )
  lines.push(
    `- ${t.skillEvidence}: ${stats.loads || 0} ${t.loads} · ${stats.closed || 0} ${t.closed} · ${t.corr} ${pct(stats.correctionRate)} · ${t.err} ${pct(stats.errRate)} · ${t.latency} ${fmt(stats.p50LoadMs, 0)}ms${
      typeof stats.tokensPerLoad === 'number' ? ' · ≈' + stats.tokensPerLoad.toLocaleString() + ' ' + t.tokPerLoad : ''
    }`,
  )
  lines.push('', `### ${t.skillIssuesHeading}`, '')
  if (advice.length === 0) {
    lines.push(`- ${t.noAdvice}`)
  } else {
    for (const raw of advice) {
      const item = adviceView(raw, lang)
      lines.push(`- **${skillSeverityIcon(item.severity)}${mdInline(item.title)}**`)
      if (item.id) lines.push(`  - ${t.issueRule}: \`${mdInline(item.id)}\``)
      if (item.evidence) lines.push(`  - ${t.issueEvidence}: ${mdInline(item.evidence)}`)
      if (item.fix) lines.push(`  - ${t.issueFix}: ${mdInline(item.fix)}`)
    }
  }
  return lines.join('\n') + '\n'
}

function CopySkillIssuesButton(props: { skill: SkillData; t: Texts; lang: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const t = props.t
  const copy = async () => {
    const ok = await copyText(skillIssuesMarkdown(props.skill, t, props.lang))
    if (!mounted.current) return
    setState(ok ? 'copied' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1500)
  }
  const label = t.copySkillIssuesTitle + ': ' + String(props.skill.skill ?? '')
  return h(
    'button',
    {
      type: 'button',
      className: 'sev-skill-copy',
      title: t.copySkillIssuesTitle,
      'aria-label': label,
      onClick: copy,
    },
    h(
      'span',
      { role: 'status', 'aria-live': 'polite' },
      state === 'copied' ? t.copied : state === 'failed' ? t.copyFailed : t.copySkillIssues,
    ),
  )
}

function CopyIssueButton(props: { item: Partial<Advice>; target: string; t: Texts }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  const t = props.t
  const copy = async () => {
    const ok = await copyText(issueMarkdown(props.item, props.target, t))
    if (!mounted.current) return
    setState(ok ? 'copied' : 'failed')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 1500)
  }
  return h(
    'button',
    {
      type: 'button',
      className: 'sev-issue-copy',
      title: t.copyIssue,
      'aria-label': t.copyIssue + ': ' + props.item.title,
      onClick: copy,
    },
    h(
      'span',
      { role: 'status', 'aria-live': 'polite' },
      state === 'copied' ? t.copied : state === 'failed' ? t.copyFailed : t.copyIssue,
    ),
  )
}
