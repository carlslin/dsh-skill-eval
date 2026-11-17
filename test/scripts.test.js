import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const run = promisify(execFile)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

test('the packaging doctor exits 0 and prints its summary', async () => {
  const { stdout } = await run(process.execPath, [path.join(root, 'scripts/doctor.mjs')], { cwd: root })
  assert.match(stdout, /^dsh-skill-eval doctor/m)
  assert.match(stdout, /PASS — manifest, patch, client keys and imports agree\./)
})

test('the packaging doctor exits non-zero when the manifest is broken', async () => {
  // no --release artifact check here: simulate a missing patch file via a temp cwd
  const { writeFile, mkdtemp, rm, copyFile } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const dir = await mkdtemp(path.join(tmpdir(), 'sev-doctor-'))
  try {
    await copyFile(path.join(root, 'scripts/doctor.mjs'), path.join(dir, 'doctor.mjs'))
    await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'dsh-skill-eval', version: '0.0.0' }))
    await assert.rejects(run(process.execPath, [path.join(dir, 'doctor.mjs')], { cwd: dir }), (error) => {
      assert.notEqual(error.code, 0)
      return true
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
