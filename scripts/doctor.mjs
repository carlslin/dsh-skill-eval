#!/usr/bin/env node
/**
 * Packaging doctor: catch drift between the manifest, the bundle patch, the
 * client registration keys and the files those names point at.
 *
 * These are the failures that only show up as "the plugin silently does not
 * appear" after a restart, so they are worth a cheap pre-flight check.
 */
import { access, readFile, readdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const rows = []
const add = (id, ok, detail) => rows.push({ id, ok, detail })
const run = promisify(execFile)

async function exists(relative) {
  try {
    await access(path.join(root, relative))
    return true
  } catch {
    return false
  }
}

const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))

add('manifest-name', manifest.name === 'dsh-skill-eval', manifest.name)
add('manifest-version', /^\d+\.\d+\.\d+$/.test(manifest.version ?? ''), manifest.version)
add(
  'exports-host',
  typeof manifest.exports?.['.'] === 'string' || typeof manifest.exports?.['.']?.default === 'string',
  JSON.stringify(manifest.exports?.['.'] ?? null),
)
add('exports-client', Boolean(manifest.exports?.['./client']), JSON.stringify(manifest.exports?.['./client'] ?? null))
add('engines-dsh', typeof manifest.dsh?.engines?.dsh === 'string', manifest.dsh?.engines?.dsh ?? 'missing')
add(
  'bundle-patch',
  Boolean(manifest.dsh?.bundle?.patch) && (await exists(manifest.dsh.bundle.patch)),
  manifest.dsh?.bundle?.patch ?? 'missing',
)
add('client-platform', manifest.dsh?.client?.platform === 'web', JSON.stringify(manifest.dsh?.client ?? null))

// bundle patch row -> native settings key the client must register
let rowId
try {
  const patch = await readFile(path.join(root, manifest.dsh?.bundle?.patch ?? 'cordis.patch.yml'), 'utf8')
  const match = patch.match(/^\s*-\s*id:\s*([A-Za-z0-9_-]+)\s*$/m)
  rowId = match?.[1] ?? null
  add('patch-row-id', Boolean(rowId), rowId ?? 'no `- id:` row found in the patch')
} catch (error) {
  add('patch-row-id', false, error instanceof Error ? error.message : String(error))
}
try {
  const client = await readFile(path.join(root, 'client.js'), 'utf8')
  // The native settings page is the bundle config seat, keyed by package name
  // (same pattern as dsh-context), so the key must appear in the client.
  const bundleKey = manifest.name
  const hasSeat = client.includes("name: 'plugins.bundle.config'")
  add(
    'bundle-config-key',
    hasSeat && client.includes(`key: '${bundleKey}'`),
    hasSeat
      ? `client registers plugins.bundle.config key "${bundleKey}"`
      : 'plugins.bundle.config seat missing in client',
  )
  add(
    'board-panel-seat',
    client.includes("name: 'sidebar.panellist'") && client.includes("name: 'main'"),
    'sidebar.panellist + main panel registration present',
  )
} catch (error) {
  add('bundle-config-key', false, error instanceof Error ? error.message : String(error))
}

// every relative import must resolve (a typo here is a silent boot failure)
const sources = [
  'index.js',
  'client.js',
  ...(await readdir(path.join(root, 'lib'))).filter((name) => name.endsWith('.js')).map((name) => `lib/${name}`),
]
const missingImports = []
for (const source of sources) {
  const text = await readFile(path.join(root, source), 'utf8')
  for (const match of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(root, path.dirname(source), match[1])
    if (!(await exists(path.relative(root, target)))) missingImports.push(`${source} → ${match[1]}`)
  }
}
add(
  'relative-imports',
  missingImports.length === 0,
  missingImports.length === 0 ? `${sources.length} file(s) clean` : missingImports.join('; '),
)

// locale resources feed the plugin's localized title/description in the UI
let localeOk = false
let localeDetail
try {
  const zh = JSON.parse(await readFile(path.join(root, 'locale/zh.json'), 'utf8'))
  const en = JSON.parse(await readFile(path.join(root, 'locale/en.json'), 'utf8'))
  const ok = (entry) =>
    entry &&
    entry.meta &&
    typeof entry.meta.title === 'string' &&
    entry.meta.title.length > 0 &&
    typeof entry.meta.description === 'string' &&
    entry.meta.description.length > 0
  localeOk = ok(zh) && ok(en)
  localeDetail = localeOk ? 'zh/en meta.title + meta.description present' : 'meta.title/meta.description missing'
} catch (error) {
  localeDetail = error instanceof Error ? error.message : String(error)
}
add('locale-meta', localeOk, localeDetail)

// the shipped client.js must match its source parts
try {
  await run(process.execPath, [path.join(root, 'scripts/build-client.mjs'), '--check'], { cwd: root })
  add('client-build', true, 'client.js matches client/*.js')
} catch {
  add('client-build', false, 'client.js is stale: run `node scripts/build-client.mjs`')
}

// the client half must reference the versioned data route it will fetch
try {
  const client = await readFile(path.join(root, 'client.js'), 'utf8')
  add(
    'client-data-version',
    client.includes(`'${manifest.version}'`) || client.includes(`"${manifest.version}"`),
    `client DATA_VERSION matches ${manifest.version}`,
  )
} catch {
  add('client-data-version', false, 'client.js unreadable')
}

// ---------------------------------------------------------------- release gate
// Run with --release before publishing: these catch the mistakes that make a
// tarball installable-but-broken (no license, private:true, docs screenshots
// inside the package, missing bins, stale dist artifact).
add(
  'license-file',
  (await exists('LICENSE')) && manifest.license === 'MIT',
  manifest.license
    ? `${manifest.license} · ${(await exists('LICENSE')) ? 'LICENSE present' : 'LICENSE missing'}`
    : 'no license field',
)
add(
  'publishable',
  manifest.private !== true,
  manifest.private === true ? 'package.json still has private:true' : 'private not set',
)
const declaredFiles = Array.isArray(manifest.files) ? manifest.files : []
const filesOk =
  declaredFiles.includes('index.js') &&
  declaredFiles.includes('client.js') &&
  declaredFiles.includes('lib/**/*.js') &&
  declaredFiles.includes('cordis.patch.yml') &&
  declaredFiles.includes('icon.svg') &&
  declaredFiles.includes('docs/*.md') &&
  !declaredFiles.includes('docs')
add(
  'package-files',
  filesOk,
  filesOk
    ? 'files list is explicit and excludes docs/ui screenshots'
    : `unexpected files list: ${declaredFiles.join(', ')}`,
)
const bins = manifest.bin ?? {}
const binScripts = Object.values(bins)
const binsExist =
  ['dsh-skill-eval-verify', 'dsh-skill-eval-doctor', 'dsh-skill-eval-accept'].every((name) => name in bins) &&
  (await Promise.all(binScripts.map((script) => exists(script.replace(/^\.\//, ''))))).every(Boolean)
add('bin-complete', binsExist, Object.keys(bins).join(', ') || 'no bins')
add(
  'release-script',
  typeof manifest.scripts?.['release:check'] === 'string',
  manifest.scripts?.['release:check'] ?? 'missing release:check',
)
if (process.argv.includes('--release')) {
  const artifact = `dist/${manifest.name}-${manifest.version}.tgz`
  add(
    'dist-artifact',
    await exists(artifact),
    (await exists(artifact)) ? artifact : `run "npm run release:pack" to build ${artifact}`,
  )
}

const failed = rows.filter((row) => !row.ok)
console.log(`dsh-skill-eval doctor — ${manifest.name}@${manifest.version}`)
for (const row of rows) console.log(`  [${row.ok ? 'PASS' : 'FAIL'}] ${row.id.padEnd(20)} ${row.detail}`)
console.log('')
if (failed.length > 0) {
  console.log(`FAIL (${failed.length}) — fix these before a restart, they cause silent non-appearance.`)
  process.exit(1)
}
console.log('PASS — manifest, patch, client keys and imports agree.')
