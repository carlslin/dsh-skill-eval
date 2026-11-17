const React = require('react')
const h = React.createElement
const { useEffect, useRef, useState, useSyncExternalStore } = React

const env = { locale: null }

// ---------------------------------------------------------------- store
function createStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    get: () => state,
    set(next) {
      state = typeof next === 'function' ? next(state) : next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const store = createStore({ open: false, view: 'skills', loading: false, error: null, data: null, fetchedAt: 0 })
const useStore = () => useSyncExternalStore(store.subscribe, store.get, store.get)

// The in-conversation turn card is the product surface; the popup is an
// optional extra. Set `window.__SEV_ENABLE_POPUP__ = true` in the page (or
// flip the default here) to bring the sidebar button and modal back.
const ENABLE_POPUP = typeof window !== 'undefined' && window.__SEV_ENABLE_POPUP__ === true
