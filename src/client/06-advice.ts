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
