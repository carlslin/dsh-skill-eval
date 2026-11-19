/**
 * Runtime settings page support.
 *
 * The plugin config lives in the profile, which is not editable from a browser.
 * This module keeps a small, validated override file inside the data directory
 * (`settings.json`) so the reporting board can expose a configuration page
 * without touching profile files. Overrides win over profile values and are
 * applied on the next load as well as immediately in memory.
 */

import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { escapeHtml as escape } from './html.ts'
import { ensurePrivateDir, writePrivateAtomic } from './store.ts'

export interface SettingsField {
  key: string
  label: string
  type: 'number' | 'boolean'
  min?: number
  max?: number
  step?: number
  help?: string
  helpZh?: string
  unit?: string
  unitZh?: string
  group?: string
  groupZh?: string
}

const NUMBER = (min: number, max: number, step = 1) => ({ type: 'number' as const, min, max, step })
const BOOL = { type: 'boolean' as const }

/** Every field the settings page may change, with bounds and labels. */
export const SETTINGS_FIELDS: SettingsField[] = [
  { key: 'weights.static', label: 'weight: static', ...NUMBER(0, 100, 5) },
  { key: 'weights.reliability', label: 'weight: reliability', ...NUMBER(0, 100, 5) },
  { key: 'weights.effectiveness', label: 'weight: effectiveness', ...NUMBER(0, 100, 5) },
  { key: 'weights.efficiency', label: 'weight: efficiency', ...NUMBER(0, 100, 5) },
  { key: 'thresholds.excellent', label: 'grade A ≥', ...NUMBER(1, 100) },
  { key: 'thresholds.good', label: 'grade B ≥', ...NUMBER(1, 100) },
  { key: 'thresholds.pass', label: 'grade C ≥', ...NUMBER(1, 100) },
  { key: 'minSamples', label: 'min samples for an interval', ...NUMBER(1, 100) },
  { key: 'windowToolCalls', label: 'window evidence limit (tool calls)', ...NUMBER(1, 200) },
  { key: 'windowTtlMs', label: 'window TTL (ms)', ...NUMBER(60000, 86400000, 60000) },
  { key: 'maxAdvice', label: 'max actionable fixes per report', ...NUMBER(1, 10) },
  { key: 'ciResamples', label: 'bootstrap resamples', ...NUMBER(0, 2000) },
  { key: 'tokenBudgetPerLoad', label: 'token budget per load', ...NUMBER(1000, 1000000, 1000) },
  { key: 'cacheReadWeight', label: 'cached input weight', ...NUMBER(0, 1, 0.05) },
  { key: 'pruneMinLoads', label: 'prune after N loads', ...NUMBER(1, 100) },
  { key: 'pruneMaxScore', label: 'prune below score', ...NUMBER(0, 100) },
  { key: 'editBudgetMax', label: 'edit budget max', ...NUMBER(1, 10) },
  { key: 'editBudgetMin', label: 'edit budget min', ...NUMBER(1, 10) },
  { key: 'editBudgetHorizon', label: 'budget anneal horizon', ...NUMBER(1, 30) },
  { key: 'noveltyWindow', label: 'exploration window', ...NUMBER(2, 10) },
  { key: 'mcpErrorRatePercent', label: 'MCP error-rate alert %', ...NUMBER(1, 100) },
  { key: 'mcpToolErrorRatePercent', label: 'MCP tool error-rate alert %', ...NUMBER(1, 100) },
  { key: 'mcpP95Ms', label: 'MCP p95 alert (ms)', ...NUMBER(100, 600000) },
  { key: 'mcpToolP95Ms', label: 'MCP tool p95 alert (ms)', ...NUMBER(100, 600000) },
  { key: 'adviceNoiseFloor', label: 'advice noise floor', ...BOOL },
  { key: 'redactCorrections', label: 'redact user corrections', ...BOOL },
  { key: 'countTokens', label: 'capture token usage', ...BOOL },
  { key: 'promptHint', label: 'inject prompt hint', ...BOOL },
  { key: 'reportOnTurnEnd', label: 'write snapshot every turn', ...BOOL },
  { key: 'turnReports', label: 'write per-turn boards', ...BOOL },
  { key: 'turnReportsKeep', label: 'per-turn boards to keep', ...NUMBER(1, 500) },
]

// Short help lines mirror the generic settings layout (label + description +
// control); the same text is shipped to the client form.
const FIELD_HELP: Record<string, { en: string; zh: string }> = {
  'weights.static': { en: 'Weight of the authoring-quality dimension.', zh: '静态质量维度的权重。' },
  'weights.reliability': { en: 'Weight of load success and follow-up errors.', zh: '加载成功率与后续错误的权重。' },
  'weights.effectiveness': { en: 'Weight of user corrections and ignored loads.', zh: '用户纠正与加载后忽略的权重。' },
  'weights.efficiency': { en: 'Weight of tool calls, latency and tokens.', zh: '工具调用、延迟与 token 的权重。' },
  'thresholds.excellent': { en: 'Total score needed to reach grade A.', zh: '总分达到多少才算 A 级。' },
  'thresholds.good': { en: 'Total score needed to reach grade B.', zh: '总分达到多少才算 B 级。' },
  'thresholds.pass': { en: 'Total score needed to reach grade C.', zh: '总分达到多少才算 C 级。' },
  minSamples: { en: 'Loads before an interval and grade become stable.', zh: '达到多少加载后区间与等级才算稳定。' },
  windowToolCalls: {
    en: 'Tool calls after a load that still count as evidence (applies immediately).',
    zh: '加载后多少次工具调用仍计为证据（立即生效）。',
  },
  maxAdvice: { en: 'Actionable fixes shown per skill.', zh: '每个技能展示的可行动修复数。' },
  ciResamples: {
    en: 'Bootstrap resamples for the 95% interval (0 disables it; high values cost CPU per report).',
    zh: '95% 区间的 bootstrap 重采样次数（0 关闭；数值越大每次报告越耗 CPU）。',
  },
  windowTtlMs: { en: 'How long an open window keeps waiting for follow-up work.', zh: '打开的窗口等待后续工作多久。' },
  tokenBudgetPerLoad: {
    en: 'Billable tokens one load may cost before efficiency reacts.',
    zh: '单次加载可计费 token 预算，超出会拉低效率分。',
  },
  cacheReadWeight: {
    en: 'How much a cached input token counts against the budget.',
    zh: '缓存输入 token 折算进预算的比例。',
  },
  countTokens: {
    en: 'Attribute real provider usage to the open windows.',
    zh: '把真实 provider 用量归因到打开的窗口。',
  },
  adviceNoiseFloor: {
    en: 'Only keep a rate-based severity when it clears its 95% interval.',
    zh: '只有越过 95% 区间的比例类问题才保持原严重度。',
  },
  redactCorrections: {
    en: 'Store only a redacted placeholder for user correction text.',
    zh: '用户纠正只存脱敏占位符，不存原文。',
  },
  pruneMinLoads: { en: 'Loads required before a prune recommendation appears.', zh: '出现剪枝建议前所需的加载次数。' },
  editBudgetHorizon: {
    en: 'Accepted edits over which the budget anneals to its minimum.',
    zh: '编辑预算退火到下限所需的已接受改动数。',
  },
  noveltyWindow: {
    en: 'Consecutive same-dimension edits that trigger exploration.',
    zh: '连续同维度改动达到多少次时触发探索转向。',
  },
  pruneMaxScore: {
    en: 'Score below which a well-sampled skill is a prune candidate.',
    zh: '样本充足时，低于该分数会成为剪枝候选。',
  },
  editBudgetMax: { en: 'Concurrent edits a first-round skill may carry.', zh: '首轮技能允许同时改动的数量。' },
  editBudgetMin: { en: 'Floor after the budget anneals.', zh: '预算退火后的下限。' },
  mcpErrorRatePercent: {
    en: 'MCP server error rate that raises a critical fix.',
    zh: 'MCP 服务器错误率达到多少时给出 critical 修复。',
  },
  mcpP95Ms: {
    en: 'MCP server p95 latency that raises a slow-server warning.',
    zh: 'MCP 服务器 p95 延迟达到多少时告警。',
  },
  mcpToolErrorRatePercent: {
    en: 'Single MCP tool error rate that raises a warning.',
    zh: '单个 MCP 工具错误率达到多少时告警。',
  },
  mcpToolP95Ms: {
    en: 'Single MCP tool p95 latency that raises a slow-tool warning.',
    zh: '单个 MCP 工具 p95 延迟达到多少时告警。',
  },
  promptHint: {
    en: 'One-line system-prompt hint; off means zero fixed token cost.',
    zh: '系统提示里的单行提示；关闭即零固定 token 成本。',
  },
  reportOnTurnEnd: {
    en: 'Write latest.md/latest.json after each settled turn. Trio: latest + turns + keep.',
    zh: '每个结算回合后写 latest.md/latest.json。快照三件套：latest + turns + keep。',
  },
  turnReports: {
    en: 'Write one board per settled turn under reports/turns/.',
    zh: '每个结算回合在 reports/turns/ 下写一块看板。',
  },
  turnReportsKeep: {
    en: 'How many per-turn boards to keep.',
    zh: '保留多少块按回合看板。',
  },
}
const FIELD_UNIT: Record<string, string> = {
  'weights.static': '%',
  'weights.reliability': '%',
  'weights.effectiveness': '%',
  'weights.efficiency': '%',
  minSamples: 'loads',
  windowToolCalls: 'calls',
  windowTtlMs: 'ms',
  tokenBudgetPerLoad: 'tokens',
  pruneMinLoads: 'loads',
  editBudgetMax: 'edits',
  editBudgetMin: 'edits',
  editBudgetHorizon: 'edits',
  turnReportsKeep: 'boards',
  mcpP95Ms: 'ms',
  mcpToolP95Ms: 'ms',
}

/** Units are stored in English; the Chinese page and the in-panel form use these. */
export const UNIT_ZH: Record<string, string> = {
  loads: '次加载',
  tokens: 'token',
  edits: '次修改',
  calls: '次调用',
  boards: '块看板',
}

for (const field of SETTINGS_FIELDS) {
  const help = FIELD_HELP[field.key]
  if (help) {
    field.help = help.en
    field.helpZh = help.zh
  }
  if (FIELD_UNIT[field.key]) {
    field.unit = FIELD_UNIT[field.key]
    field.unitZh = UNIT_ZH[field.unit] ?? field.unit
  }
}

const FIELD_BY_KEY = new Map(SETTINGS_FIELDS.map((field) => [field.key, field]))

export function unitLabel(unit: string | null | undefined, zh: boolean): string {
  if (!unit) return ''
  return zh ? (UNIT_ZH[unit] ?? unit) : unit
}

export const SETTINGS_GROUPS = [
  {
    title: 'Scoring',
    titleZh: '评分权重与阈值',
    keys: [
      'weights.static',
      'weights.reliability',
      'weights.effectiveness',
      'weights.efficiency',
      'thresholds.excellent',
      'thresholds.good',
      'thresholds.pass',
      'minSamples',
      'maxAdvice',
      'ciResamples',
    ],
  },
  { title: 'Cost', titleZh: '成本', keys: ['tokenBudgetPerLoad', 'cacheReadWeight', 'countTokens'] },
  {
    title: 'Advice & lifecycle',
    titleZh: '建议与生命周期',
    keys: [
      'adviceNoiseFloor',
      'redactCorrections',
      'windowToolCalls',
      'windowTtlMs',
      'pruneMinLoads',
      'pruneMaxScore',
      'editBudgetMax',
      'editBudgetMin',
      'editBudgetHorizon',
      'noveltyWindow',
    ],
  },
  {
    title: 'MCP',
    titleZh: 'MCP',
    keys: ['mcpErrorRatePercent', 'mcpToolErrorRatePercent', 'mcpP95Ms', 'mcpToolP95Ms'],
  },
  {
    title: 'Snapshots & output',
    titleZh: '快照与输出',
    keys: ['promptHint', 'reportOnTurnEnd', 'turnReports', 'turnReportsKeep'],
  },
]

const GROUP_BY_KEY = new Map<string, (typeof SETTINGS_GROUPS)[number]>()
for (const group of SETTINGS_GROUPS) for (const key of group.keys) GROUP_BY_KEY.set(key, group)
for (const field of SETTINGS_FIELDS) {
  const group = GROUP_BY_KEY.get(field.key)
  if (group) {
    field.group = group.title
    field.groupZh = group.titleZh
  }
}

export const FIELD_ZH: Record<string, string> = {
  'weights.static': '权重：静态质量',
  'weights.reliability': '权重：可靠性',
  'weights.effectiveness': '权重：有效性',
  'weights.efficiency': '权重：效率',
  'thresholds.excellent': 'A 级下限',
  'thresholds.good': 'B 级下限',
  'thresholds.pass': 'C 级下限',
  minSamples: '给区间所需最小样本',
  windowToolCalls: '窗口证据上限 (调用数)',
  maxAdvice: '每轮最多可行动建议',
  ciResamples: 'bootstrap 重采样次数',
  tokenBudgetPerLoad: '单次加载 token 预算',
  cacheReadWeight: '缓存命中折算权重',
  windowTtlMs: '窗口有效期 (ms)',
  pruneMinLoads: '剪枝所需加载次数',
  pruneMaxScore: '低于该分数进入剪枝候选',
  editBudgetMax: '编辑预算上限',
  editBudgetMin: '编辑预算下限',
  editBudgetHorizon: '预算退火跨度',
  noveltyWindow: '探索窗口',
  mcpErrorRatePercent: 'MCP 错误率告警 %',
  mcpToolErrorRatePercent: 'MCP 工具错误率告警 %',
  mcpP95Ms: 'MCP p95 告警 (ms)',
  mcpToolP95Ms: 'MCP 工具 p95 告警 (ms)',
  adviceNoiseFloor: '建议噪声地板',
  redactCorrections: '脱敏用户纠正',
  countTokens: '采集 token 用量',
  promptHint: '注入提示词',
  reportOnTurnEnd: '每回合写快照',
  turnReports: '每回合写看板',
  turnReportsKeep: '看板保留数',
}

type ConfigTarget = Record<string, unknown>

const SET = (target: ConfigTarget, keyPath: string, value: unknown) => {
  const [head, leaf] = keyPath.split('.')
  if (leaf) {
    target[head] = { ...((target[head] as object | undefined) ?? {}), [leaf]: value }
  } else {
    target[head] = value
  }
}

/**
 * Parse and validate submitted values.
 *
 * @param {Record<string, string|boolean|number>} input flat `key → value` map
 * @returns {{values: Record<string, unknown>, errors: Array<{key: string, message: string}>}}
 */
export function normalizeSettings(input: Record<string, unknown> | null | undefined): {
  values: Record<string, unknown>
  errors: Array<{ key: string; message: string }>
} {
  const values: Record<string, unknown> = {}
  const errors: Array<{ key: string; message: string }> = []
  for (const [key, raw] of Object.entries(input ?? {})) {
    const field = FIELD_BY_KEY.get(key)
    if (!field) continue
    if (field.type === 'boolean') {
      values[key] = raw === true || raw === 'on' || raw === 'true' || raw === '1'
      continue
    }
    const num = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : NaN
    if (!Number.isFinite(num)) {
      errors.push({ key, message: `not a number: ${String(raw)}` })
      continue
    }
    if (num < (field.min ?? -Infinity) || num > (field.max ?? Infinity)) {
      errors.push({ key, message: `out of range ${field.min}..${field.max}` })
      continue
    }
    values[key] = num
  }
  const weights = ['static', 'reliability', 'effectiveness', 'efficiency'].filter(
    (name) => typeof values[`weights.${name}`] === 'number',
  )
  if (weights.length === 4) {
    const sum = weights.reduce((total, name) => total + (values[`weights.${name}`] as number), 0)
    if (sum <= 0) errors.push({ key: 'weights.total', message: 'weights sum must be positive' })
  }
  // Snapshot trio as one object: settings.json (or the settings API) may use
  // snapshots.latest/turns/keep, or a nested snapshots: {latest, turns, keep}
  // object, instead of the three flat keys. Dotted keys win over the nested
  // object when both are present.
  const nested =
    input && typeof input.snapshots === 'object' && input.snapshots !== null && !Array.isArray(input.snapshots)
      ? (input.snapshots as Record<string, unknown>)
      : null
  const trio: Record<string, string> = {
    'snapshots.latest': 'reportOnTurnEnd',
    'snapshots.turns': 'turnReports',
    'snapshots.keep': 'turnReportsKeep',
  }
  for (const [alias, flat] of Object.entries(trio)) {
    const leaf = alias.slice('snapshots.'.length)
    const source = input as Record<string, unknown> | null | undefined
    const raw = source?.[alias] !== undefined ? source[alias] : nested?.[leaf]
    if (raw === undefined) continue
    if (flat === 'turnReportsKeep') {
      const num =
        typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.trim()) : NaN
      const field = FIELD_BY_KEY.get(flat)
      if (!Number.isFinite(num) || num < (field?.min ?? -Infinity) || num > (field?.max ?? Infinity)) {
        errors.push({ key: alias, message: `out of range ${field?.min}..${field?.max}` })
        continue
      }
      values[flat] = num
      continue
    }
    values[flat] = raw === true || raw === 'on' || raw === 'true' || raw === '1'
  }
  return { values, errors }
}

/** Read the override file; missing or unreadable means "no overrides". */
/**
 * Parse an HTML form body. Unchecked checkboxes are simply absent from a form
 * POST, so booleans must default to false — otherwise "turn this off" can
 * never be saved from the plain web settings page.
 */
export function parseFormSettings(body: string | null | undefined): Record<string, string | boolean> {
  const submitted: Record<string, string | boolean> = Object.fromEntries(new URLSearchParams(body ?? ''))
  // Only a submission from our own full form may turn absent checkboxes into
  // false. A partial POST (other clients, CSRF) must leave prior values alone.
  const fullForm = submitted.__full_form === '1'
  delete submitted.__full_form
  if (fullForm) {
    for (const field of SETTINGS_FIELDS) {
      if (field.type === 'boolean' && !(field.key in submitted)) submitted[field.key] = false
    }
  }
  return submitted
}

export async function loadSettings(dataDir: unknown): Promise<Record<string, unknown>> {
  if (typeof dataDir !== 'string' || dataDir.length === 0) return {}
  try {
    const raw = await readFile(path.join(dataDir, 'settings.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

let saveQueue: Promise<unknown> = Promise.resolve()

function enqueueSettingsWrite(dataDir: string, resolveValues: () => unknown): Promise<string> {
  const file = path.join(dataDir, 'settings.json')
  const job = saveQueue.then(async () => {
    // Resolve inside the queue: a read-merge-write (updateSettings) must see
    // the result of the previous job, not the stale file from before it.
    const values = await resolveValues()
    await ensurePrivateDir(dataDir)
    await writePrivateAtomic(file, `${JSON.stringify(values, null, 2)}\n`)
    return file
  })
  saveQueue = job.catch(() => {})
  return job
}

/**
 * Serialize writes and replace the file atomically: a crash mid-write leaves
 * the previous file intact instead of truncated JSON that would silently drop
 * every override.
 */
export function saveSettings(dataDir: string, values: Record<string, unknown>): Promise<string> {
  return enqueueSettingsWrite(dataDir, () => canonicalSnapshotSettings(values))
}

/**
 * Rewrite the snapshot aliases as the three canonical flat keys. The form only
 * posts flat keys, and aliases take precedence on load, so leaving a stale
 * `snapshots` object in the file would silently undo every form save after a
 * restart. Aliased values are read with the normal precedence first, then the
 * aliases are removed; unrelated keys are preserved.
 */
function canonicalSnapshotSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const nested = settings.snapshots
  const hasNested = Boolean(nested) && typeof nested === 'object' && !Array.isArray(nested)
  const aliases = ['snapshots.latest', 'snapshots.turns', 'snapshots.keep']
  if (!hasNested && !aliases.some((key) => key in settings)) return settings
  const { values } = normalizeSettings(settings)
  const next = { ...settings }
  if (typeof values.reportOnTurnEnd === 'boolean') next.reportOnTurnEnd = values.reportOnTurnEnd
  if (typeof values.turnReports === 'boolean') next.turnReports = values.turnReports
  if (typeof values.turnReportsKeep === 'number') next.turnReportsKeep = values.turnReportsKeep
  delete next.snapshots
  for (const key of aliases) delete next[key]
  return next
}

/**
 * Merge a partial patch into the settings file inside the write queue. Two
 * overlapping HTTP saves must not both read the pre-update file and drop each
 * other's field; the whole read-merge-write therefore runs as one queued job.
 * Snapshot aliases are canonicalised before the merge so a patch that only
 * carries flat trio keys is never shadowed by a stale alias on the next load.
 */
export function updateSettings(dataDir: string, patch: unknown): Promise<string> {
  return enqueueSettingsWrite(dataDir, async () => {
    const canonical = canonicalSnapshotSettings(await loadSettings(dataDir))
    const merged = {
      ...canonical,
      ...(patch && typeof patch === 'object' ? patch : {}),
    }
    return canonicalSnapshotSettings(merged)
  })
}

/** Synchronous variant used at plugin apply time (the config must exist first). */
export function loadSettingsSync(dataDir: unknown): Record<string, unknown> {
  if (typeof dataDir !== 'string' || dataDir.length === 0) return {}
  try {
    const parsed = JSON.parse(readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Merge flat override keys into a config-shaped object (mutates and returns it). */
export function applySettings<T extends object>(target: T, values: Record<string, unknown> | null | undefined): T {
  for (const [key, value] of Object.entries(values ?? {})) {
    if (!FIELD_BY_KEY.has(key)) continue
    SET(target as ConfigTarget, key, value)
  }
  return target
}

/** Current effective value for one field, from a config-shaped object. */
export function readSetting(config: object | null | undefined, key: string): unknown {
  const [head, leaf] = key.split('.')
  const top = (config as ConfigTarget | null | undefined)?.[head]
  if (leaf) return (top as ConfigTarget | null | undefined)?.[leaf]
  return top
}

/** Render the configuration page. */
export function renderConfigHtml({
  config,
  base,
  saved = false,
  errors = [],
  lang = 'en',
}: {
  config: object
  base: string
  saved?: boolean
  errors?: Array<{ key: string; message: string }>
  lang?: string
}): string {
  const zh = lang === 'zh'
  const label = (def: SettingsField) => (zh && FIELD_ZH[def.key] ? FIELD_ZH[def.key] : def.label)
  const groupTitle = (group: (typeof SETTINGS_GROUPS)[number]) => (zh && group.titleZh ? group.titleZh : group.title)
  const field = (def: SettingsField) => {
    const value = readSetting(config, def.key)
    if (def.type === 'boolean') {
      return `<label class="row check"><input type="checkbox" name="${def.key}" ${
        value === true ? 'checked' : ''
      }><span>${escape(label(def))}</span></label>`
    }
    const help = zh ? def.helpZh : def.help
    return `<label class="row"><span class="label">${escape(label(def))}${
      help ? `<small>${escape(help)}</small>` : ''
    }</span><span class="control"><input type="number" name="${def.key}" value="${escape(value ?? '')}" min="${
      def.min
    }" max="${def.max}" step="${def.step}">${def.unit ? `<em>${escape(unitLabel(def.unit, zh))}</em>` : ''}</span></label>`
  }
  const groups = SETTINGS_GROUPS.map(
    (group) =>
      `<section><h2>${escape(groupTitle(group))}</h2>${group.keys
        .map((key) => FIELD_BY_KEY.get(key))
        .filter((def) => def !== undefined)
        .map(field)
        .join('')}</section>`,
  ).join('')
  return `<!doctype html>
<html lang="${zh ? 'zh' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${zh ? '技能评测 · 配置' : 'Skill eval · Config'}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;padding:28px;font:14px/1.55 ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fafafa;color:#18181b;max-width:760px}
@media (prefers-color-scheme:dark){body{background:#111113;color:#e7e7ea}section{background:#1a1a1e!important;border-color:#2a2a30!important}input{background:#111113!important;color:#e7e7ea!important}h2{color:#d4d4d8!important}.row small,.sub{color:#a1a1aa!important}}
h1{font-size:18px;margin:0 0 4px}
.sub{color:#71717a;font-size:12px;margin-bottom:18px}
section{background:#fff;border:1px solid #e5e5e9;border-radius:12px;padding:14px 16px;margin-bottom:14px}
h2{font-size:13px;margin:0 0 10px;color:#52525b}
.row{display:grid;grid-template-columns:minmax(180px,1fr) 200px;gap:12px;align-items:center;font-size:12px;padding:9px 0;border-bottom:1px solid #f0f0f2}.row .label{display:flex;flex-direction:column;gap:2px}.row small{color:#71717a;font-size:11px;font-weight:400}.row .control{display:flex;align-items:center;gap:6px;justify-content:flex-end}.row .control em{font-style:normal;color:#71717a;font-size:11px}
.row input[type=number]{padding:5px 7px;border:1px solid #d4d4d8;border-radius:7px;font:inherit}
.row.check{grid-template-columns:24px 1fr}
button{padding:8px 16px;border-radius:9px;border:1px solid #18181b;background:#18181b;color:#fff;font:inherit;cursor:pointer}
a{color:#3b82f6;text-decoration:none;font-size:12px}
.banner{padding:8px 12px;border-radius:9px;font-size:12px;margin-bottom:14px}
.banner.ok{background:#dcfce7;color:#166534}
.banner.err{background:#fee2e2;color:#991b1b}
</style></head>
<body>
<h1>${zh ? '技能评测 · 配置' : 'Skill eval · Config'}</h1>
<div class="sub">${
    zh
      ? '保存到数据目录的 <code>settings.json</code>，优先于 profile 配置，立即生效并覆盖下次加载。'
      : 'Saved to <code>settings.json</code> in the data directory; it wins over the profile config and applies immediately.'
  } <a href="${escape(base)}">${zh ? '← 返回看板' : '← Board'}</a> · <a href="?lang=${zh ? 'en' : 'zh'}">${
    zh ? 'English' : '中文'
  }</a></div>
${saved ? `<div class="banner ok">${zh ? '已保存并应用。' : 'Saved and applied.'}</div>` : ''}
${
  errors.length
    ? `<div class="banner err">${
        zh ? `有 ${errors.length} 个字段未保存：` : `${errors.length} field(s) rejected: `
      }${errors.map((error) => `${escape(error.key)} (${escape(error.message)})`).join(zh ? '；' : '; ')}</div>`
    : ''
}
<form method="post" action="${escape(base)}/config">
<input type="hidden" name="__full_form" value="1">
${groups}
<button type="submit">${zh ? '保存' : 'Save'}</button>
</form>
</body></html>`
}

export const SETTINGS_FILE = 'settings.json'
