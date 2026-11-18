import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { dashboardBase, expectedVersion, httpGet, parseCliArgs, resolveBaseUrl } from '../src/scripts/lib.mts'

test('flags consume their values instead of leaking into the base URL', () => {
  assert.deepEqual(parseCliArgs(['--data-dir', '/tmp/d']), { baseArg: null, values: { '--data-dir': '/tmp/d' } })
  assert.deepEqual(parseCliArgs(['http://127.0.0.1:1', '--data-dir', '/tmp/d']), {
    baseArg: 'http://127.0.0.1:1',
    values: { '--data-dir': '/tmp/d' },
  })
  assert.deepEqual(parseCliArgs(['--data-dir=/tmp/d', 'http://h']), {
    baseArg: 'http://h',
    values: { '--data-dir': '/tmp/d' },
  })
  assert.deepEqual(parseCliArgs(['--release', '--data-dir', '/x']), { baseArg: null, values: { '--data-dir': '/x' } })
})

test('base URL precedence: argument, DSH_WEB_URL, relay bridge', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'sev-cli-'))
  const saved = { DSH_HOME: process.env.DSH_HOME, DSH_WEB_URL: process.env.DSH_WEB_URL }
  try {
    await writeFile(
      path.join(home, 'remote-web-ui-relay-bridge.json'),
      JSON.stringify({ upstream: 'http://127.0.0.1:7777' }),
    )
    process.env.DSH_HOME = home
    delete process.env.DSH_WEB_URL
    assert.deepEqual(await resolveBaseUrl(), { baseUrl: 'http://127.0.0.1:7777', source: 'relay-bridge' })
    process.env.DSH_WEB_URL = 'http://127.0.0.1:8888/'
    assert.deepEqual(await resolveBaseUrl(), { baseUrl: 'http://127.0.0.1:8888', source: 'DSH_WEB_URL' })
    assert.deepEqual(await resolveBaseUrl('http://127.0.0.1:9999'), {
      baseUrl: 'http://127.0.0.1:9999',
      source: 'argument',
    })
  } finally {
    if (saved.DSH_HOME === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved.DSH_HOME
    if (saved.DSH_WEB_URL === undefined) delete process.env.DSH_WEB_URL
    else process.env.DSH_WEB_URL = saved.DSH_WEB_URL
    await rm(home, { recursive: true, force: true })
  }
})

test('dashboard base and expected version follow their environment overrides', () => {
  const saved = { base: process.env.DSH_SKILL_EVAL_BASE, version: process.env.DSH_SKILL_EVAL_VERSION }
  try {
    delete process.env.DSH_SKILL_EVAL_BASE
    assert.equal(dashboardBase(), '/skill-eval')
    process.env.DSH_SKILL_EVAL_BASE = '/metrics/'
    assert.equal(dashboardBase(), '/metrics')
    delete process.env.DSH_SKILL_EVAL_VERSION
    assert.equal(expectedVersion('1.2.3'), '1.2.3')
    process.env.DSH_SKILL_EVAL_VERSION = '9.9.9'
    assert.equal(expectedVersion('1.2.3'), '9.9.9')
  } finally {
    if (saved.base === undefined) delete process.env.DSH_SKILL_EVAL_BASE
    else process.env.DSH_SKILL_EVAL_BASE = saved.base
    if (saved.version === undefined) delete process.env.DSH_SKILL_EVAL_VERSION
    else process.env.DSH_SKILL_EVAL_VERSION = saved.version
  }
})

test('httpGet asserts status and content type with the URL in the error', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('{"ok":true}')
      return
    }
    if (req.url === '/missing') {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end('<html></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as import('node:net').AddressInfo
  const base = `http://127.0.0.1:${port}`
  try {
    assert.deepEqual(await httpGet(base, '/json', { expectType: 'application/json' }), {
      body: '{"ok":true}',
      type: 'application/json',
    })
    await assert.rejects(httpGet(base, '/page', { expectType: 'application/json' }), /expected application\/json/)
    await assert.rejects(httpGet(base, '/missing', { expectType: 'application/json' }), /HTTP 404/)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
