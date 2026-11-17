/**
 * Cordis Inspect provider: the developer-mode surface of this plugin.
 *
 * `cordis_inspect_list` / `cordis_inspect_query` are the read-only capabilities
 * the harness exposes to a developer (and to the model when the inspector
 * bundle is on). Registering here means the eval data is queryable next to the
 * harness's own Service/Event/Config providers instead of only through HTTP.
 */

const EMPTY_INPUT = { type: 'object', properties: {}, additionalProperties: false }
const ANY_OUTPUT = { description: 'JSON data owned by the skill-eval inspect provider.' }

const SKILL_INPUT = {
  type: 'object',
  properties: {
    skill: { type: 'string', description: 'Exact skill name.' },
  },
  required: ['skill'],
  additionalProperties: false,
}

function adviceIds(advice) {
  return (advice ?? []).map((item) => ({
    id: item.id,
    severity: item.severity,
    dimension: item.dimension,
  }))
}

/** Bounded summary row: numbers plus advice identity, never the full prose. */
function summarize(entry) {
  const score = entry.score ?? {}
  const dims = score.dimensions ?? {}
  return {
    skill: entry.skill,
    score: score.total,
    grade: score.grade,
    confidence: score.confidence,
    provisional: score.provisional,
    loads: entry.stats?.loads ?? 0,
    closed: entry.stats?.closed ?? 0,
    ci: score.ci ?? null,
    dimensions: {
      static: dims.static,
      reliability: dims.reliability,
      effectiveness: dims.effectiveness,
      efficiency: dims.efficiency,
    },
    advice: adviceIds(entry.advice),
    adviceBudget: entry.adviceBudget ?? null,
    exploration: entry.exploration ?? null,
  }
}

export function createInspectProvider(analyzer) {
  return {
    manifest: {
      id: 'skill-eval',
      description:
        'dsh-skill-eval: recorded skill and MCP execution telemetry with 0-100 scores, A-F grades, confidence and cited fixes.',
      methods: [
        {
          name: 'summary',
          description: 'Every skill with score, grade, confidence, four dimensions and advice identities.',
          inputSchema: EMPTY_INPUT,
          outputSchema: ANY_OUTPUT,
        },
        {
          name: 'skill',
          description: 'One skill entry in full, including its advice text.',
          inputSchema: SKILL_INPUT,
          outputSchema: ANY_OUTPUT,
        },
        {
          name: 'mcp',
          description: 'Per-MCP-server calls, error rate, average latency and health score.',
          inputSchema: EMPTY_INPUT,
          outputSchema: ANY_OUTPUT,
        },
        {
          name: 'runs',
          description: 'Recent per-session runs: loads, tool calls, errors, corrections and skills.',
          inputSchema: EMPTY_INPUT,
          outputSchema: ANY_OUTPUT,
        },
        {
          name: 'edits',
          description: 'Audit ledger of reviewed skill edits: hypothesis, leakage verdict and reasons.',
          inputSchema: EMPTY_INPUT,
          outputSchema: ANY_OUTPUT,
        },
        {
          name: 'standard',
          description: 'The active grading standard: normalised weights, grade floors and minimum samples.',
          inputSchema: EMPTY_INPUT,
          outputSchema: ANY_OUTPUT,
        },
      ],
    },

    async query(method, input) {
      if (method === 'summary') {
        const report = await analyzer.build()
        return {
          generatedAt: report.generatedAt,
          dataDir: report.dataDir,
          totals: report.totals,
          scoring: report.scoring ?? null,
          skills: report.skills.map(summarize),
        }
      }
      if (method === 'skill') {
        const name = input && typeof input.skill === 'string' ? input.skill : ''
        if (name.length === 0) throw new Error('skill-eval inspect: "skill" is required')
        const entry = await analyzer.buildOne(name)
        if (!entry) throw new Error(`skill-eval inspect: no evidence recorded for "${name}"`)
        return entry
      }
      if (method === 'mcp') {
        const report = await analyzer.build()
        return {
          generatedAt: report.generatedAt,
          mcpServers: report.mcpServers ?? [],
          advice: report.mcpAdvice ?? [],
        }
      }
      if (method === 'edits') {
        const report = await analyzer.build()
        return { generatedAt: report.generatedAt, edits: report.edits ?? [] }
      }
      if (method === 'runs') {
        const report = await analyzer.build()
        return { generatedAt: report.generatedAt, runs: report.runs ?? [] }
      }
      if (method === 'standard') {
        const report = await analyzer.build()
        return { scoring: report.scoring ?? null }
      }
      throw new Error(`skill-eval inspect: unknown method "${method}"`)
    },
  }
}
