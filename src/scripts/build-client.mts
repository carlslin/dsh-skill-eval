#!/usr/bin/env node
/**
 * Build the browser artifact from src/client/*.ts.
 *
 * The DSH client loader evaluates one self-contained factory file, and this
 * project deliberately avoids a bundler dependency. Each part is a TypeScript
 * snippet in the factory's lexical scope; this script strips the types from
 * each part, concatenates them in `src/client/parts.json` order and wraps the
 * result in the loader format. Type checking is `tsc -p src/client`.
 * `npm run build:client` runs `tsc` first, then this file, so a clean checkout
 * does not need a pre-existing `scripts/`. Stripping types imports the
 * `typescript` devDependency; this is not a zero-dependency script.
 *
 *   npm run build:client                   # emit, then write client.js
 *   node scripts/build-client.mjs --check  # exit 1 when client.js is stale
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

// The emitted copy lives in <root>/scripts/. The source lives in
// <root>/src/scripts/. Both must find the repo root.
const here = path.dirname(fileURLToPath(import.meta.url))
const root =
  path.basename(here) === 'scripts' && path.basename(path.dirname(here)) === 'src'
    ? path.resolve(here, '../..')
    : path.resolve(here, '..')
const sourceDir = path.join(root, 'src/client')
const parts: string[] = JSON.parse(await readFile(path.join(sourceDir, 'parts.json'), 'utf8'))

const header = `/**
 * GENERATED FILE — do not edit directly.
 * Source: src/client/*.ts · build: npm run build:client
 */
window.__ModuleLoader__.load({
  id: 'dsh-skill-eval',
  factory(require) {
`
const footer = `  },
})
`
const indent = (text: string) =>
  text
    .split('\n')
    .map((line) => (line.length > 0 ? `    ${line}` : line))
    .join('\n')
const strip = (text: string, fileName: string) =>
  ts
    .transpileModule(text, {
      fileName,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.Preserve,
        moduleDetection: ts.ModuleDetectionKind.Legacy,
        removeComments: false,
        newLine: ts.NewLineKind.LineFeed,
      },
      // every part compiles inside one shared factory scope: a per-part
      // `use strict` directive would be dead code mid-function
    })
    .outputText.replace(/^"use strict";\s*\n/, '')
const sections: string[] = []
for (const part of parts) {
  const text = await readFile(path.join(sourceDir, part), 'utf8')
  sections.push(`    // src/client/${part}\n${indent(strip(text, part).trimEnd())}\n`)
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
    console.error('client.js is stale: run `npm run build:client` and re-check the page.')
    process.exit(1)
  }
  console.log('client.js is up to date with src/client/*.ts')
} else {
  await writeFile(target, output, 'utf8')
  console.log(`client.js rebuilt from ${parts.length} parts (${output.length} chars)`)
}
