import test from 'node:test'
import assert from 'node:assert/strict'
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, stat, utimes } from 'node:fs/promises'
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

test('the file never exceeds the cap and stays owner-only after rotation', async () => {
  await withStore(
    async (store) => {
      for (let index = 0; index < 40; index += 1) {
        await store.append({ t: 'step', step: index, pad: 'x'.repeat(120) })
        const info = await stat(store.file)
        assert.ok(info.size <= 1000, `after append ${index}: ${info.size} bytes`)
      }
      assert.equal((await stat(store.file)).mode & 0o777, 0o600)
    },
    { maxBytes: 1000 },
  )
})

test('a rotation always leaves half the cap of headroom, edits included', async () => {
  await withStore(
    async (store) => {
      const stepBytes = (index) =>
        Buffer.byteLength(JSON.stringify({ t: 'step', step: index, pad: 'x'.repeat(120) })) + 1
      let previous = 0
      const checkSize = async (index) => {
        const info = await stat(store.file)
        if (previous > 0 && info.size < previous) {
          assert.ok(info.size <= 500 + stepBytes(index), `rotation left ${info.size} bytes after append ${index}`)
        }
        previous = info.size
      }
      for (let index = 0; index < 30; index += 1) {
        await store.append({ t: 'edit', skill: 'a', seq: index, pad: 'x'.repeat(55) })
        await checkSize(index)
      }
      for (let index = 0; index < 40; index += 1) {
        await store.append({ t: 'step', step: index, pad: 'x'.repeat(120) })
        await checkSize(index)
      }
      const raw = await readFile(store.file, 'utf8')
      const editLines = raw.split('\n').filter((line) => line.includes('"edit"'))
      const editBytes = editLines.reduce((total, line) => total + Buffer.byteLength(line) + 1, 0)
      assert.ok(editBytes <= 250, `edits kept ${editBytes} bytes`)
      const seqs = (await store.readAll()).filter((r) => r.t === 'edit').map((r) => r.seq)
      assert.ok(seqs.length > 0)
      assert.equal(seqs.at(-1), 29)
      assert.deepEqual(
        seqs,
        Array.from({ length: seqs.length }, (_, index) => 29 - seqs.length + 1 + index),
      )
    },
    { maxBytes: 1000 },
  )
})

test('rotation keeps the edit ledger ahead of the newest suffix', async () => {
  await withStore(
    async (store) => {
      await store.append({ t: 'edit', skill: 'a', verdict: 'accept', at: 1 })
      for (let index = 0; index < 40; index += 1) {
        await store.append({ t: 'step', step: index, pad: 'x'.repeat(120) })
      }
      const records = await store.readAll()
      const edits = records.filter((record) => record.t === 'edit')
      assert.equal(edits.length, 1)
      assert.equal(records[0].t, 'edit')
      const steps = records.slice(1).map((record) => record.step)
      assert.ok(steps.length > 0 && steps.length < 40)
      assert.deepEqual(
        steps,
        Array.from({ length: steps.length }, (_, index) => 40 - steps.length + index),
      )
    },
    { maxBytes: 2000 },
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

test('a stale lock file is cleared instead of blocking appends', async () => {
  await withStore(async (store) => {
    const lock = `${store.file}.lock`
    await appendFile(lock, 'x', 'utf8')
    const past = new Date(Date.now() - 60_000)
    await utimes(lock, past, past)
    await store.append({ t: 'skill', skill: 'a' })
    assert.equal((await store.readAll()).at(-1).skill, 'a')
    await assert.rejects(stat(lock))
  })
})

test('a held lock delays an append until it is released', async () => {
  await withStore(async (store) => {
    const lock = `${store.file}.lock`
    await appendFile(lock, 'x', 'utf8')
    let resolvedAt = 0
    const pending = store.append({ t: 'skill', skill: 'a' }).then(() => {
      resolvedAt = Date.now()
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    assert.equal(resolvedAt, 0, 'append completed while the lock was held')
    const releasedAt = Date.now()
    await rm(lock, { force: true })
    await pending
    assert.ok(resolvedAt >= releasedAt)
    assert.equal((await store.readAll()).at(-1).skill, 'a')
    await assert.rejects(stat(lock))
  })
})

test('two stores sharing one directory lose no records', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sev-store-lock-'))
  try {
    const a = new EventStore(dir, { maxBytes: 3000 })
    const b = new EventStore(dir, { maxBytes: 3000 })
    const appendAll = async (store, tag) => {
      for (let index = 0; index < 60; index += 1) {
        await store.append({ store: tag, seq: index, pad: 'x'.repeat(60) })
        // yield past the lock poll interval so the other store gets its turn
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    await Promise.all([appendAll(a, 'a'), appendAll(b, 'b')])
    const records = await a.readAll()
    for (const tag of ['a', 'b']) {
      const seqs = records.filter((r) => r.store === tag).map((r) => r.seq)
      assert.ok(seqs.length > 0, `store ${tag} kept records`)
      assert.equal(seqs.at(-1), 59)
      assert.deepEqual(
        seqs,
        Array.from({ length: seqs.length }, (_, index) => 59 - seqs.length + 1 + index),
        `store ${tag} has a gap in its surviving records`,
      )
    }
    await assert.rejects(stat(`${a.file}.lock`))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a new data directory is owner-only; an existing one keeps its mode', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sev-store-mode-'))
  try {
    const existing = path.join(root, 'existing')
    await mkdir(existing)
    await chmod(existing, 0o755)
    await appendFile(path.join(existing, 'events.jsonl'), '{"t":"skill","skill":"old"}\n', { mode: 0o644 })
    const store = new EventStore(existing)
    await store.append({ t: 'skill', skill: 'a' })
    assert.equal((await stat(existing)).mode & 0o777, 0o755)
    assert.equal((await stat(store.file)).mode & 0o777, 0o600)
    const nested = path.join(root, 'nested', 'profile')
    const fresh = new EventStore(nested)
    await fresh.append({ t: 'skill', skill: 'b' })
    assert.equal((await stat(nested)).mode & 0o777, 0o700)
    assert.equal((await stat(fresh.file)).mode & 0o777, 0o600)
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
