import assert from 'node:assert/strict'
import { createRoot } from 'react-dom/client'
import type { DOMWindow } from 'jsdom'

/** Shared jsdom host for client tests: appends a div and returns it with a React root. */
export function createHost(window: DOMWindow, style: Partial<CSSStyleDeclaration> = {}) {
  const host = window.document.createElement('div')
  Object.assign(host.style, style)
  window.document.body.appendChild(host)
  return { host, root: createRoot(host) }
}

export type DeepPartial<T> = T extends readonly (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> | null }
    : T

/**
 * A fixture that carries only the fields a test exercises. The fields it does
 * set are still checked against the real type; the code under test is
 * defensive about the rest, which is exactly what these tests pin.
 */
export const partial = <T>(value: DeepPartial<T>) => value as T

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Fn = (...args: any[]) => any

/** Fake DSH host objects: the host ships no typings, same seam as src/lib/types.ts. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Fake = any

/** Find a row by id and fail the test with its id when it is missing. */
export function byId<T extends { id: string }>(rows: readonly T[], id: string): T {
  const row = rows.find((item) => item.id === id)
  assert.ok(row, `missing row "${id}"`)
  return row
}

/** Deliberately malformed input for robustness tests: bypasses the type on purpose. */
export const corrupt = <T>(value: unknown) => value as T
