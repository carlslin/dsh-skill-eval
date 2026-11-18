// Destructured rather than bound to `React`: @types/react declares a global
// `React` namespace that a script-scope const would collide with.
const {
  createElement: h,
  Fragment,
  memo,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} = require('react') as typeof import('react')

const env: { locale: LocaleService | null } = { locale: null }

// ---------------------------------------------------------------- store
function createStore<T>(initial: T) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    get: () => state,
    set(next: T | ((current: T) => T)) {
      state = typeof next === 'function' ? (next as (current: T) => T)(state) : next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const store = createStore<AppState>({
  open: false,
  view: 'skills',
  loading: false,
  error: null,
  data: null,
  fetchedAt: 0,
})
const useStore = () => useSyncExternalStore(store.subscribe, store.get, store.get)

// The in-conversation turn card is the product surface; the popup is an
// optional extra. Set `window.__SEV_ENABLE_POPUP__ = true` in the page (or
// flip the default here) to bring the sidebar button and modal back.
const ENABLE_POPUP = typeof window !== 'undefined' && window.__SEV_ENABLE_POPUP__ === true
