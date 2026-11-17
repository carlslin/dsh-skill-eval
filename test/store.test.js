import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, appendFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventStore } from '../lib/store.js'

async function withStore(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sev-store-'))
  try {
    return await fn(new EventStore(dir), dir)
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
