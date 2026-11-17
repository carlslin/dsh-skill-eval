import { createRoot } from 'react-dom/client'

/** Shared jsdom host for client tests: appends a div and returns it with a React root. */
export function createHost(window, style = {}) {
  const host = window.document.createElement('div')
  Object.assign(host.style, style)
  window.document.body.appendChild(host)
  return { host, root: createRoot(host) }
}
