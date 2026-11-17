import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const run = promisify(execFile)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const EXCLUDED = new Set(['.git', 'node_modules', 'client', 'dist', 'test', '.pi'])

/** Copy the package the way npm pack would see it (no sources, no dev dirs). */
async function copyPackage(dir) {
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
      assert.notEqual(error.code, 0)
      assert.match(String(error.stdout), /\[FAIL\] bundle-patch/)
      return true
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
