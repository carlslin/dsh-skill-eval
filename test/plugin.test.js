import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Config, apply, inject, name } from '../index.js'

function fakeCtx(extras = {}) {
  const registered = { tools: [], commands: [], routes: [], sections: [] }
  const disposers = []
  const ctx = {
    on: () => () => {},
    effect(fn) {
      const dispose = fn()
      disposers.push(dispose)
      return dispose
    },
    inject(deps, callback) {
      callback(ctx)
      return { then: () => undefined }
    },
    tools: {
      register(definition) {
        registered.tools.push(definition)
        return () => {
          registered.tools = registered.tools.filter((d) => d !== definition)
        }
      },
    },
    skills: {
      async list() {
        return extras.summaries ?? []
      },
      async get(skillName) {
        return (extras.definitions ?? {})[skillName]
      },
    },
    commands: {
      register(definition) {
        registered.commands.push(definition)
        return () => {}
      },
    },
    webServer: {
      register(route) {
        registered.routes.push(route)
        return () => {}
      },
      getOrigin() {
        return 'http://127.0.0.1:1234'
      },
    },
    systemPrompt: {
      section(section) {
        registered.sections.push(section)
        return () => {}
      },
    },
    logger: () => ({ info() {} }),
  }
  return { ctx, registered, disposers }
}

async function withDataDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'skill-eval-plugin-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('manifest declares the host dependencies cordis can resolve', () => {
  assert.equal(name, 'skill-eval')
  assert.deepEqual(inject, ['tools', 'skills'])
  assert.equal(typeof Config, 'function')
})

test('apply registers the report tool, command, route and prompt section', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir, minSamples: 3, maxAdvice: 2 })

    assert.deepEqual(registered.tools.map((tool) => tool.name).sort(), ['skill_eval_report', 'skill_eval_review'])
    const reportTool = registered.tools.find((tool) => tool.name === 'skill_eval_report')
    assert.equal(reportTool.parameters.type, 'object')
    assert.equal(typeof reportTool.output.render, 'function')

    assert.equal(registered.commands.length, 1)
    assert.equal(registered.commands[0].name, 'skill-eval')

    const exact = registered.routes.filter((r) => r.kind === 'exact').map((r) => r.path)
    const pageRoute = registered.routes.find((r) => r.kind === 'prefix')
    const version = JSON.parse(
      await import('node:fs/promises').then((fs) => fs.readFile(new URL('../package.json', import.meta.url), 'utf8')),
    ).version
    assert.deepEqual(
      exact.sort(),
      [
        `/skill-eval/data/${version}`,
        '/skill-eval/data',
        '/skill-eval',
        '/skill-eval/config',
        `/skill-eval/board/${version}`,
        `/skill-eval/board/${version}/config`,
        `/skill-eval/settings/${version}`,
        '/skill-eval/settings',
      ].sort(),
    )
    assert.equal(pageRoute.path, '/skill-eval')

    assert.equal(registered.sections.length, 1)
    assert.equal(registered.sections[0].name, 'skill-eval:usage')
    assert.match(registered.sections[0].text({}), /skill_eval_report/)
  })
})

async function seedWindows(dataDir, skill = 'pdf-tools', count = 3) {
  const { appendFile, mkdir } = await import('node:fs/promises')
  await mkdir(dataDir, { recursive: true })
  const lines = []
  for (let i = 0; i < count; i += 1) {
    lines.push(
      JSON.stringify({
        t: 'skill',
        at: Date.now(),
        sessionId: 's',
        skill,
        callId: `c${i}`,
        windowId: `s:c${i}`,
        loadMs: 80,
        origin: 'tool',
        turn: 1,
      }),
    )
    lines.push(
      JSON.stringify({
        t: 'window',
        at: Date.now(),
        windowId: `s:c${i}`,
        sessionId: 's',
        skill,
        toolCalls: 3,
        errors: 1,
        errorNames: ['E'],
        corrections: i === 0 ? ['不对'] : [],
        otherSkills: [],
        turnEnded: true,
        truncated: false,
        closeReason: 'user-turn',
      }),
    )
  }
  await appendFile(`${dataDir}/events.jsonl`, lines.join('\n') + '\n')
}

test('the tool answers with an empty-state report instead of failing', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const tool = registered.tools.find((item) => item.name === 'skill_eval_report')
    const text = await tool.execute({}, {})
    assert.match(text, /No skill loads recorded yet/)
    const json = await tool.execute({ format: 'json' }, {})
    const parsed = JSON.parse(json)
    assert.equal(parsed.totals.skills, 0)
    assert.equal(Array.isArray(parsed.skills), true)
  })
})

test('an unknown skill name reports what is available', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const text = await registered.tools
      .find((item) => item.name === 'skill_eval_report')
      .execute({ skill: 'missing-skill' }, {})
    assert.match(text, /No evidence recorded for skill/)
  })
})

test('a skill with only a static profile is still reported as having no runtime evidence', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx({
      summaries: [
        {
          name: 'pdf-tools',
          description:
            'Use when the user needs to extract, split, merge or annotate PDF files: read page text, reorder pages, fill forms.',
          whenToUse: 'Any task whose input or output is a .pdf file.',
          source: 'user-dsh',
          invocation: { modelInvocable: true, userInvocable: true },
        },
      ],
      definitions: { 'pdf-tools': { content: '# PDF\n\n## Steps\n\n```bash\nx\n```\n' } },
    })
    apply(ctx, { enabled: true, dataDir, minSamples: 1 })
    const tool = registered.tools.find((item) => item.name === 'skill_eval_report')
    const text = await tool.execute({ skill: 'pdf-tools' }, {})
    assert.match(text, /No evidence recorded for skill/)
  })
})

test('web route serves html and json', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const route = registered.routes.find((r) => r.kind === 'prefix')

    async function call(url) {
      const chunks = []
      const res = {
        status: 0,
        headers: {},
        writeHead(status, headers) {
          this.status = status
          this.headers = headers
        },
        end(body) {
          chunks.push(body)
        },
      }
      await route.handler({ url }, res)
      return { status: res.status, headers: res.headers, body: chunks.join('') }
    }

    const page = await call('/skill-eval')
    assert.equal(page.status, 200)
    assert.match(page.headers['content-type'], /text\/html/)
    assert.match(page.body, /<!doctype html>/)

    const data = await call('/skill-eval/data')
    assert.equal(data.status, 200)
    assert.match(data.headers['content-type'], /application\/json/)
    assert.equal(typeof JSON.parse(data.body).totals, 'object')
  })
})

test('the command returns the summary as a success result', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const command = registered.commands[0]
    const result = await command.handler({ rawInput: '', agent: {} })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /Skill execution report/)
  })
})

test('disabled config registers nothing', async () => {
  const { ctx, registered } = fakeCtx()
  apply(ctx, { enabled: false })
  assert.deepEqual(
    [registered.tools.length, registered.commands.length, registered.routes.length, registered.sections.length],
    [0, 0, 0, 0],
  )
})

test('the system-prompt hint can be turned off to drop its per-turn tokens', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir, promptHint: false })
    assert.equal(registered.sections.length, 0)
    assert.equal(
      registered.tools.some((tool) => tool.name === 'skill_eval_report'),
      true,
    )
  })
})

test('sub-feature switches are honoured', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, {
      enabled: true,
      dataDir,
      registerTool: false,
      registerReviewTool: false,
      registerCommand: false,
      webDashboard: false,
    })
    assert.deepEqual([registered.tools.length, registered.commands.length, registered.routes.length], [0, 0, 0])
  })
})

test('dashboardPath is configurable and still serves data off its own prefix', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir, dashboardPath: '/skill-metrics' })
    const route = registered.routes.find((r) => r.kind === 'prefix')
    assert.equal(route.path, '/skill-metrics')
    const exact = registered.routes.filter((r) => r.kind === 'exact').map((r) => r.path)
    const version = JSON.parse(
      await import('node:fs/promises').then((fs) => fs.readFile(new URL('../package.json', import.meta.url), 'utf8')),
    ).version
    assert.deepEqual(
      exact.sort(),
      [
        // pages follow dashboardPath; the client bundle's data/settings
        // contract stays under the fixed /skill-eval base
        '/skill-metrics',
        '/skill-metrics/config',
        `/skill-metrics/board/${version}`,
        `/skill-metrics/board/${version}/config`,
        `/skill-eval/data/${version}`,
        '/skill-eval/data',
        `/skill-eval/settings/${version}`,
        '/skill-eval/settings',
      ].sort(),
    )

    const chunks = []
    const res = {
      writeHead() {},
      end(body) {
        chunks.push(body)
      },
    }
    await route.handler({ url: '/skill-metrics/data' }, res)
    assert.equal(typeof JSON.parse(chunks.join('')).totals, 'object')
  })
})

test('a route the host refuses to re-register does not take the plugin down', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    ctx.webServer.register = () => {
      throw new Error('webserver: duplicate prefix route "/skill-eval"')
    }
    apply(ctx, { enabled: true, dataDir })
    // the tools, the command and the prompt section still register
    assert.equal(registered.tools.length, 2)
    assert.equal(registered.commands.length, 1)
    assert.equal(registered.sections.length, 1)
    assert.equal(registered.routes.length, 0)
  })
})

test('the dashboard never renders an unescaped skill name', async () => {
  const { renderHtml } = await import('../lib/render.js')
  const html = renderHtml({
    generatedAt: new Date().toISOString(),
    dataDir: '/tmp',
    totals: { invocations: 1, skills: 1, closed: 0, open: 1, storeError: null },
    skills: [
      {
        skill: '<img src=x onerror=alert(1)>',
        source: 'user-dsh',
        stats: {
          loads: 1,
          closed: 0,
          open: 1,
          loadOkRate: 1,
          errRate: 0,
          correctionRate: 0,
          abandonRate: 0,
          siblingRate: 0,
          avgCalls: 1,
          p50LoadMs: 10,
        },
        staticQuality: null,
        score: { total: 50, grade: 'F', provisional: true, dimensions: {} },
        advice: [],
        topAdvice: [],
      },
    ],
  })
  assert.equal(html.includes('<img src=x'), false)
  assert.match(html, /&lt;img/)
})

test('a page route the host refuses still leaves the data route serving', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx({ summaries: [] })
    const realRegister = ctx.webServer.register.bind(ctx.webServer)
    ctx.webServer.register = (route) => {
      if (route.kind === 'prefix') throw new Error('webserver: duplicate prefix route "/skill-eval"')
      return realRegister(route)
    }
    apply(ctx, { enabled: true, dataDir })
    const routes = registered.routes
    assert.equal(
      routes.every((route) => route.kind === 'exact'),
      true,
    )
    assert.equal(
      routes.some((route) => route.path === '/skill-eval/data'),
      true,
    )
    assert.equal(
      routes.some((route) => route.path === '/skill-eval/config'),
      true,
    )

    const chunks = []
    const res = {
      writeHead() {},
      end(body) {
        chunks.push(body)
      },
    }
    await routes.find((route) => route.path === '/skill-eval/data').handler({ url: '/skill-eval/data' }, res)
    assert.equal(typeof JSON.parse(chunks.join('')).totals, 'object')
  })
})

test('the tool exposes MCP, runs and standard views', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const tool = registered.tools.find((item) => item.name === 'skill_eval_report')
    const mcp = await tool.execute({ view: 'mcp' }, {})
    assert.match(mcp, /MCP servers/)
    const runs = await tool.execute({ view: 'runs' }, {})
    assert.match(runs, /Recent runs/)
    const standard = await tool.execute({ view: 'standard' }, {})
    assert.match(standard, /Grading standard/)
    assert.match(standard, /weights: static/)
    const json = await tool.execute({ view: 'mcp', format: 'json' }, {})
    assert.deepEqual(JSON.parse(json).mcpServers, [])
  })
})

test('the /skill-eval command accepts mcp, runs and standard keywords', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const command = registered.commands[0]
    const mcp = await command.handler({ rawInput: 'mcp', agent: {} })
    assert.equal(mcp.kind, 'success')
    assert.match(mcp.text, /MCP servers/)
    const standard = await command.handler({ rawInput: 'standard', agent: {} })
    assert.match(standard.text, /Grading standard/)
  })
})

test('the inspect provider registers when the registry is available', async () => {
  await withDataDir(async (dataDir) => {
    const registrations = []
    const { ctx } = fakeCtx()
    ctx.cordisInspect = {
      register(provider) {
        registrations.push(provider)
        return () => {}
      },
    }
    apply(ctx, { enabled: true, dataDir })
    assert.equal(registrations.length, 1)
    assert.equal(registrations[0].manifest.id, 'skill-eval')
    const data = await registrations[0].query('summary', {})
    assert.equal(Array.isArray(data.skills), true)
  })
})

test('/skill-eval accept reports the in-process generation checks', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const result = await registered.commands[0].handler({ rawInput: 'accept', agent: {} })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /In-process acceptance/)
    assert.match(result.text, /plugin-version/)
    assert.match(result.text, /PASS/)
    // with no telemetry yet the file checks fail, and that is reported honestly
    assert.match(result.text, /FAIL/)
  })
})

test('the review tool screens an edit and records it in the ledger', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const review = registered.tools.find((tool) => tool.name === 'skill_eval_review')
    assert.ok(review, 'review tool is not registered')

    const leaked = await review.execute(
      { skill: 'pdf-tools', hypothesis: 'win on the benchmark', diff: 'if task_id == 3 return 42' },
      {},
    )
    assert.match(leaked, /reject/)
    assert.match(leaked, /task-specific-id/)

    const clean = await review.execute(
      {
        skill: 'pdf-tools',
        hypothesis: 'Sharper trigger language should cut corrections; measured over the next 5 loads.',
        diff: '+ ## When to use\n+ Use for .pdf inputs.',
      },
      {},
    )
    assert.match(clean, /accept/)

    const report = await registered.tools
      .find((tool) => tool.name === 'skill_eval_report')
      .execute({ format: 'json' }, {})
    const parsed = JSON.parse(report)
    assert.equal(parsed.edits.length, 2)
    assert.equal(parsed.edits[0].verdict, 'accept')
    assert.equal(parsed.edits[1].verdict, 'reject')
    assert.equal(parsed.edits[1].skill, 'pdf-tools')
    assert.ok(parsed.edits[1].reasons.includes('task-specific-id'))
  })
})

test('the review tool records the targeted dimension for the exploration loop', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const review = registered.tools.find((tool) => tool.name === 'skill_eval_review')
    await review.execute(
      { skill: 'pdf-tools', dimension: 'static', hypothesis: 'sharpen triggers', diff: '+ use when .pdf' },
      {},
    )
    const parsed = JSON.parse(
      await registered.tools.find((tool) => tool.name === 'skill_eval_report').execute({ format: 'json' }, {}),
    )
    assert.equal(parsed.edits[0].dimension, 'static')
    assert.equal(Array.isArray(parsed.skills), true)
  })
})

test('the loop view renders a plan from the live report', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const tool = registered.tools.find((item) => item.name === 'skill_eval_report')

    const empty = await tool.execute({ view: 'loop' }, {})
    assert.match(empty, /no skill loads/)

    await seedWindows(dataDir)
    const text = await tool.execute({ view: 'loop' }, {})
    assert.match(text, /## Optimization loop/)
    const skillText = await tool.execute({ view: 'loop', skill: 'pdf-tools' }, {})
    assert.match(skillText, /pdf-tools/)
    const asJson = await tool.execute({ view: 'loop', format: 'json' }, {})
    const plan = JSON.parse(asJson)
    assert.equal(typeof plan.budget, 'number')
    assert.equal(Array.isArray(plan.steps), true)
  })
})

test('the loop view can return every actionable skill at once', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    await seedWindows(dataDir)
    const tool = registered.tools.find((item) => item.name === 'skill_eval_report')
    const batch = await tool.execute({ view: 'loop', all: true }, {})
    assert.match(batch, /Optimization loop/)
    const asJson = JSON.parse(await tool.execute({ view: 'loop', all: true, format: 'json' }, {}))
    assert.equal(Array.isArray(asJson.plans), true)
  })
})

test('the validity view reports coverage and refuses to over-claim', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    await seedWindows(dataDir)
    const tool = registered.tools.find((item) => item.name === 'skill_eval_report')
    const text = await tool.execute({ view: 'validity' }, {})
    assert.match(text, /## Validity — what the evidence supports/)
    assert.match(text, /Cannot say yet/)
    const json = JSON.parse(await tool.execute({ view: 'validity', format: 'json' }, {}))
    assert.equal(typeof json.coverage.skills, 'number')
    assert.ok(Array.isArray(json.cannotSay))

    // the prompt hint teaches the safe order
    assert.match(registered.sections[0].text({}), /skill_eval_review/)
    assert.match(registered.sections[0].text({}), /view:"loop"/)
    assert.match(registered.sections[0].text({}), /view:"validity"/)
  })
})

test('history and impact views answer the time-aware questions', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    await seedWindows(dataDir, 'pdf-tools', 4)
    const tool = registered.tools.find((item) => item.name === 'skill_eval_report')

    const history = await tool.execute({ view: 'history', skill: 'pdf-tools' }, {})
    assert.match(history, /## History — `pdf-tools`/)
    assert.match(history, /trend:/)
    const historyJson = JSON.parse(await tool.execute({ view: 'history', skill: 'pdf-tools', format: 'json' }, {}))
    assert.equal(historyJson.loads.length, 4)

    const needsSkill = await tool.execute({ view: 'impact' }, {})
    assert.match(needsSkill, /needs a skill name/)

    const impact = await tool.execute({ view: 'impact', skill: 'pdf-tools' }, {})
    assert.match(impact, /No screened edit recorded/)
  })
})

function fakeHttp(method, urlPath, body = '') {
  const listeners = {}
  const req = {
    method,
    url: urlPath,
    headers: { 'content-type': 'application/json', 'x-skill-eval-config': '1' },
    on(event, handler) {
      listeners[event] = handler
    },
    destroy() {},
  }
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status
      Object.assign(this.headers, headers ?? {})
    },
    end(chunk) {
      this.body += chunk ?? ''
    },
  }
  return {
    req,
    res,
    flush: () => {
      if (listeners.data && body) listeners.data(Buffer.from(body))
      if (listeners.end) listeners.end()
    },
    listeners,
  }
}

async function callPrefixRoute(registered, method, urlPath, body = '') {
  const route = registered.routes.find((item) => item.kind === 'prefix')
  const { req, res, flush } = fakeHttp(method, urlPath, body)
  const pending = route.handler(req, res)
  flush()
  await pending
  return res
}

test('the configuration page is served and a POST saves working overrides', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })

    const page = await callPrefixRoute(registered, 'GET', '/skill-eval/config')
    assert.equal(page.statusCode, 200)
    assert.match(page.body, /Skill eval · Config/)
    assert.match(page.body, /name="weights.static"/)

    const dashboard = await callPrefixRoute(registered, 'GET', '/skill-eval')
    assert.match(dashboard.body, /⚙ Settings|⚙ 配置/)
    assert.match(dashboard.body, /Next steps/)
    assert.match(dashboard.body, /What the evidence supports/)

    const form = new URLSearchParams({
      'weights.static': '0.5',
      'weights.reliability': '0.2',
      'weights.effectiveness': '0.2',
      'weights.efficiency': '0.1',
      minSamples: '4',
      adviceNoiseFloor: 'on',
    }).toString()
    const saved = await callPrefixRoute(registered, 'POST', '/skill-eval/config', form)
    assert.equal(saved.statusCode, 200)
    assert.match(saved.body, /Saved and applied/)

    const data = JSON.parse((await callPrefixRoute(registered, 'GET', '/skill-eval/data')).body)
    assert.equal(data.scoring.weights.static, 0.5)
    assert.equal(data.scoring.minSamples, 4)

    const persisted = JSON.parse(
      await import('node:fs/promises').then((fs) => fs.readFile(`${dataDir}/settings.json`, 'utf8')),
    )
    assert.equal(persisted['weights.static'], 0.5)

    const bad = await callPrefixRoute(registered, 'POST', '/skill-eval/config', 'minSamples=0')
    assert.equal(bad.statusCode, 400)
    assert.match(bad.body, /rejected/)
  })
})

test('the settings API reads and writes overrides for the native config page', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const route = registered.routes.find((item) => item.kind === 'exact' && item.path === '/skill-eval/settings')
    assert.ok(route, 'settings route is not registered')

    const call = async (method, body = '') => {
      const { req, res, flush } = fakeHttp(method, '/skill-eval/settings', body)
      const pending = route.handler(req, res)
      flush()
      await pending
      return res
    }

    const read = await call('GET')
    assert.equal(read.statusCode, 200)
    const payload = JSON.parse(read.body)
    assert.equal(Array.isArray(payload.fields), true)
    assert.ok(payload.fields.some((field) => field.key === 'weights.static'))
    assert.equal(payload.values['weights.static'], 0.3)

    const write = await call('POST', JSON.stringify({ minSamples: 5, 'weights.static': 0.35 }))
    assert.equal(write.statusCode, 200)
    const saved = JSON.parse(write.body)
    assert.equal(saved.saved, true)
    assert.equal(saved.values.minSamples, 5)
    assert.equal(saved.values['weights.static'], 0.35)

    const data = JSON.parse((await callPrefixRoute(registered, 'GET', '/skill-eval/data')).body)
    assert.equal(data.scoring.minSamples, 5)
    // the report normalises weights; 0.35/1.05 rounds to 33%
    assert.equal(data.scoring.weightsPercent.static, 33)

    const invalid = await call('POST', JSON.stringify({ minSamples: 0 }))
    assert.equal(invalid.statusCode, 400)
    assert.equal(JSON.parse(invalid.body).saved, false)

    // form-encoded bodies are accepted too (the HTML page posts this way)
    const form = await call('POST', 'minSamples=3&adviceNoiseFloor=on')
    assert.equal(form.statusCode, 200)
    assert.equal(JSON.parse(form.body).values.minSamples, 3)
  })
})

test('the versioned page posts its config form to the versioned route', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const versionedConfig = registered.routes.find(
      (item) => item.kind === 'exact' && /^\/skill-eval\/board\/\d+\.\d+\.\d+\/config$/.test(item.path),
    )
    assert.ok(versionedConfig, 'versioned config route is registered')
    const versionBase = versionedConfig.path.replace(/\/config$/, '')
    const { req, res, flush } = fakeHttp('GET', versionedConfig.path)
    const pending = versionedConfig.handler(req, res)
    flush()
    await pending
    assert.equal(res.statusCode, 200)
    assert.match(res.body, new RegExp('action="' + versionBase + '/config"'))

    const versionedBoard = registered.routes.find((item) => item.kind === 'exact' && item.path === versionBase)
    assert.ok(versionedBoard, 'versioned board route is registered')
    const page = await (async () => {
      const http = fakeHttp('GET', versionBase)
      const pendingPage = versionedBoard.handler(http.req, http.res)
      http.flush()
      await pendingPage
      return http.res
    })()
    assert.equal(page.statusCode, 200)
    assert.match(page.body, new RegExp('href="' + versionBase + '/config"'))
  })
})

test('the dev view reports generation, store health and registered seats', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    ctx.cordisInspect = { register: () => () => {} }
    apply(ctx, { enabled: true, dataDir })
    await seedWindows(dataDir)
    const tool = registered.tools.find((item) => item.name === 'skill_eval_report')
    const text = await tool.execute({ view: 'dev' }, {})
    assert.match(text, /## Developer diagnostics/)
    const dev = JSON.parse(await tool.execute({ view: 'dev', format: 'json' }, {}))
    assert.equal(dev.versions.skew, false)
    assert.ok(dev.routes.some((route) => route.includes('/settings')))
    assert.ok(dev.tools.includes('skill_eval_report'))
    assert.ok(dev.tools.includes('skill_eval_review'))
    assert.equal(dev.inspectProvider, 'skill-eval')
    assert.equal(dev.store.counts.skill >= 1, true)
    assert.equal(typeof dev.config.weights.static, 'number')
  })
})

test('the turns view lists per-turn boards written by the snapshot', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const tool = registered.tools.find((item) => item.name === 'skill_eval_report')
    const empty = await tool.execute({ view: 'turns' }, {})
    assert.match(empty, /No per-turn board written yet/)

    const turnsDir = `${dataDir}/reports/turns`
    const { mkdir, writeFile } = await import('node:fs/promises')
    await mkdir(turnsDir, { recursive: true })
    await writeFile(
      `${turnsDir}/session-1-t2.json`,
      JSON.stringify({
        turnLoads: [{ sessionId: 'session-1', turn: 2 }],
        skills: [{ skill: 'pdf-tools' }],
        totals: {},
      }),
    )
    const text = await tool.execute({ view: 'turns' }, {})
    assert.match(text, /session-1-t2/)
    const asJson = JSON.parse(await tool.execute({ view: 'turns', format: 'json' }, {}))
    assert.equal(asJson.turns.length, 1)
    assert.equal(asJson.turns[0].turn, 2)
  })
})

test('the board and settings page answer in the requested language', async () => {
  await withDataDir(async (dataDir) => {
    const { ctx, registered } = fakeCtx()
    apply(ctx, { enabled: true, dataDir })
    const configRoute = registered.routes.find((item) => item.kind === 'exact' && item.path === '/skill-eval/config')
    const pageRoute = registered.routes.find((item) => item.kind === 'exact' && item.path === '/skill-eval')
    assert.ok(pageRoute, 'page route missing')

    const call = async (route, headers = {}, urlPath) => {
      const request = { method: 'GET', url: urlPath ?? route.path, headers, on() {} }
      const response = {
        writeHead() {},
        end(body) {
          this.body = body
        },
      }
      await route.handler(request, response)
      return response.body
    }

    assert.match(await call(pageRoute), /Skill execution report/)
    assert.match(await call(pageRoute, { 'accept-language': 'zh-CN,zh;q=0.9' }), /技能执行报告/)
    // explicit query beats the header
    assert.match(await call(pageRoute, { 'accept-language': 'zh-CN' }, '/skill-eval?lang=en'), /Skill execution report/)
    assert.match(await call(configRoute), /Skill eval · Config/)
    assert.match(await call(configRoute, { 'accept-language': 'zh-CN' }), /技能评测 · 配置/)
  })
})
