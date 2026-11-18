import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const run = promisify(execFile)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const EXCLUDED = new Set(['.git', 'node_modules', 'src', 'dist', 'test', '.pi'])

/** Copy the package the way npm pack would see it (no sources, no dev dirs). */
async function copyPackage(dir: string) {
  await cp(root, dir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(root, src)
      if (rel === '') return true
      const head = rel.split(path.sep)[0]
      // npm does not pack dot-directories; sockets (e.g. .codegraph) also
      // cannot be copied.
      return !EXCLUDED.has(head) && !head.startsWith('.')
    },
  })
}

async function typescriptFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await typescriptFiles(full)))
    else if (/\.(ts|mts)$/.test(entry.name)) out.push(full)
  }
  return out
}

test('tests import src, and a clone is not documented as installable', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  assert.match(pkg.scripts['build:client'], /^tsc -p tsconfig\.json && node scripts\/build-client\.mjs$/)
  assert.equal(pkg.scripts.test, 'node --experimental-strip-types --test "test/**/*.test.ts"')
  assert.ok(pkg.files.includes('!scripts/build-client.mjs'))
  const offenders: string[] = []
  for (const file of await typescriptFiles(path.join(root, 'test'))) {
    const text = await readFile(file, 'utf8')
    if (/(?:from|import\()\s*['"]\.\.\/(?:lib\/|index\.js|scripts\/)/.test(text)) {
      offenders.push(path.relative(root, file))
    }
  }
  assert.deepEqual(offenders, [])
  const readme = await readFile(path.join(root, 'README.md'), 'utf8')
  const readmeZh = await readFile(path.join(root, 'README.zh.md'), 'utf8')
  assert.match(readme, /npm pack/)
  assert.match(readmeZh, /npm pack/)
  assert.doesNotMatch(readme, /needs no build step/)
  assert.doesNotMatch(readme, /zero-dependency/)
  assert.doesNotMatch(readmeZh, /安装无需构建/)
  assert.doesNotMatch(readmeZh, /零依赖/)
})

test('the packaging doctor exits 0 in a source checkout', async () => {
  const { stdout } = await run(process.execPath, [path.join(root, 'scripts/doctor.mjs')], { cwd: root })
  assert.match(stdout, /^dsh-skill-eval doctor/m)
  assert.match(stdout, /\[PASS\] client-build\s+client\.js matches/)
  assert.match(stdout, /PASS — manifest, patch, client keys and imports agree\./)
})

test('the packaging doctor passes in a packaged install without client/ sources', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sev-doctor-pack-'))
  try {
    await copyPackage(dir)
    const { stdout } = await run(process.execPath, [path.join(dir, 'scripts/doctor.mjs')], { cwd: dir })
    assert.match(stdout, /\[PASS\] client-build\s+packaged install/)
    assert.match(stdout, /PASS — manifest, patch, client keys and imports agree\./)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the packaging doctor catches a broken package instead of crashing on ENOENT', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sev-doctor-broken-'))
  try {
    await copyPackage(dir)
    await rm(path.join(dir, 'cordis.patch.yml'))
    await assert.rejects(run(process.execPath, [path.join(dir, 'scripts/doctor.mjs')], { cwd: dir }), (error) => {
      const failure = error as { code?: number; stdout?: string }
      assert.notEqual(failure.code, 0)
      assert.match(String(failure.stdout), /\[FAIL\] bundle-patch/)
      return true
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
