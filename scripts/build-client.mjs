#!/usr/bin/env node
/**
 * Build the browser artifact from client/*.js.
 *
 * The DSH client loader evaluates one self-contained factory file, and this
 * project deliberately avoids a bundler dependency. Each part is a plain
 * JavaScript snippet in the factory's lexical scope; this script concatenates
 * them in `client/parts.json` order and wraps the result in the loader format.
 *
 *   node scripts/build-client.mjs          # write client.js
 *   node scripts/build-client.mjs --check  # exit 1 when client.js is stale
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const parts = JSON.parse(await readFile(path.join(root, 'client/parts.json'), 'utf8'))

const header = `/**
 * GENERATED FILE — do not edit directly.
 * Source: client/*.js · build: node scripts/build-client.mjs
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-eval',
  factory(require) {
`
const footer = `  },
})
`
const indent = (text) =>
  text
    .split('\n')
    .map((line) => (line.length > 0 ? `    ${line}` : line))
    .join('\n')
const sections = []
for (const part of parts) {
  const text = await readFile(path.join(root, 'client', part), 'utf8')
  sections.push(`    // client/${part}\n${indent(text.trimEnd())}\n`)
}
const output = header + '\n' + sections.join('\n') + footer

const target = path.join(root, 'client.js')
if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = await readFile(target, 'utf8')
  } catch {
    // missing counts as stale
  }
  if (current !== output) {
    console.error('client.js is stale: run `node scripts/build-client.mjs` and re-check the page.')
    process.exit(1)
  }
  console.log('client.js is up to date with client/*.js')
} else {
  await writeFile(target, output, 'utf8')
  console.log(`client.js rebuilt from ${parts.length} parts (${output.length} chars)`)
}
