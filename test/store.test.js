import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventStore } from '../lib/store.js'

async function withStore(fn, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sev-store-'))
  try {
    return await fn(new EventStore(dir, options), dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a torn tail is closed before the next append, so the new record survives', async () => {
  await withStore(async (store, _dir) => {
    await store.append({ t: 'skill', skill: 'a' })
    // simulate a crash mid-write: the previous process left a partial line
    await appendFile(store.file, '{"t":"skill","skill":"los', 'utf8')
    await store.append({ t: 'window', windowId: 'w1' })
    const records = await store.readAll()
    assert.equal(records.length, 2)
    assert.deepEqual(
      records.map((record) => record.t),
      ['skill', 'window'],
    )
    const raw = await readFile(store.file, 'utf8')
    const lines = raw.split('\n').filter(Boolean)
    // the damaged fragment stays on its own line and readAll skips it; the
    // repaired record after it must be intact
    assert.doesNotThrow(() => JSON.parse(lines.at(-1)))
  })
})

test('the event file keeps a bounded newest suffix instead of growing forever', async () => {
  await withStore(
    async (store) => {
      for (let index = 0; index < 60; index += 1)
        await store.append({ t: 'skill', skill: `s${index}`, pad: 'x'.repeat(40) })
      const raw = await readFile(store.file, 'utf8')
      assert.ok(Buffer.byteLength(raw) <= 600, `file stayed bounded (got ${Buffer.byteLength(raw)} bytes)`)
      assert.ok(raw.endsWith('\n'))
      const records = await store.readAll()
      assert.ok(records.length > 1 && records.length < 60)
      assert.equal(records.at(-1).skill, 's59')
      // the kept records are a contiguous newest suffix, oldest first
      assert.deepEqual(
        records.map((record) => record.skill),
        Array.from({ length: records.length }, (_, index) => `s${60 - records.length + index}`),
      )
    },
    { maxBytes: 600 },
  )
})

test('a single record larger than the cap is still kept', async () => {
  await withStore(
    async (store) => {
      await store.append({ t: 'skill', skill: 'huge', pad: 'x'.repeat(400) })
      const records = await store.readAll()
      assert.deepEqual(
        records.map((record) => record.skill),
        ['huge'],
      )
    },
    { maxBytes: 80 },
  )
})

test('the data directory is owner-only, including one created by an older version', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sev-store-mode-'))
  try {
    const existing = path.join(root, 'existing')
    await mkdir(existing)
    await chmod(existing, 0o755)
    const store = new EventStore(existing)
    await store.append({ t: 'skill', skill: 'a' })
    assert.equal((await stat(existing)).mode & 0o777, 0o700)
    const nested = path.join(root, 'nested', 'profile')
    await new EventStore(nested).append({ t: 'skill', skill: 'b' })
    assert.equal((await stat(nested)).mode & 0o777, 0o700)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('append failures are captured without breaking the queue', async () => {
  await withStore(async (store) => {
    const { mkdir, rm: remove } = await import('node:fs/promises')
    await store.append({ t: 'skill', skill: 'a' })
    // a directory in place of the file makes the next append fail
    await remove(store.file, { force: true })
    await mkdir(store.file)
    await store.append({ t: 'skill', skill: 'b' })
    assert.ok(store.failed, 'failure is recorded')
    await remove(store.file, { recursive: true, force: true })
    await store.append({ t: 'skill', skill: 'c' })
    assert.equal(store.failed, null)
    const records = await store.readAll()
    assert.equal(records.at(-1).skill, 'c')
  })
})
