// Chinese copy for rule-generated advice (host attaches titleZh/fixZh).
const adviceView = (item, lang) =>
  item && lang === 'zh' && item.titleZh ? { ...item, title: item.titleZh, fix: item.fixZh || item.fix } : item

// Copy JSON/markdown for the agent. The async Clipboard API needs a real
// user gesture and can be missing on plain-http hosts, so fall back to the
// hidden-textarea + execCommand path before reporting failure.
async function copyText(text) {
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
