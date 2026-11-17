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
import { readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { escapeHtml as escape } from './html.js'
import { ensurePrivateDir } from './store.js'

const NUMBER = (min, max, step = 1) => ({ type: 'number', min, max, step })
const BOOL = { type: 'boolean' }

/** Every field the settings page may change, with bounds and labels. */
export const SETTINGS_FIELDS = [
  { key: 'weights.static', label: 'weight: static', ...NUMBER(0, 100, 5) },
  { key: 'weights.reliability', label: 'weight: reliability', ...NUMBER(0, 100, 5) },
  { key: 'weights.effectiveness', label: 'weight: effectiveness', ...NUMBER(0, 100, 5) },
  { key: 'weights.efficiency', label: 'weight: efficiency', ...NUMBER(0, 100, 5) },
  { key: 'thresholds.excellent', label: 'grade A ≥', ...NUMBER(1, 100) },
  { key: 'thresholds.good', label: 'grade B ≥', ...NUMBER(1, 100) },
  { key: 'thresholds.pass', label: 'grade C ≥', ...NUMBER(1, 100) },
  { key: 'minSamples', label: 'min samples for an interval', ...NUMBER(1, 100) },
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
  { key: 'mcpP95Ms', label: 'MCP p95 alert (ms)', ...NUMBER(100, 600000) },
  { key: 'adviceNoiseFloor', label: 'advice noise floor', ...BOOL },
  { key: 'countTokens', label: 'capture token usage', ...BOOL },
  { key: 'promptHint', label: 'inject prompt hint', ...BOOL },
  { key: 'reportOnTurnEnd', label: 'write snapshot every turn', ...BOOL },
]

// Short help lines mirror the generic settings layout (label + description +
// control); the same text is shipped to the client form.
const FIELD_HELP = {
  'weights.static': { en: 'Weight of the authoring-quality dimension.', zh: '静态质量维度的权重。' },
  'weights.reliability': { en: 'Weight of load success and follow-up errors.', zh: '加载成功率与后续错误的权重。' },
  'weights.effectiveness': { en: 'Weight of user corrections and ignored loads.', zh: '用户纠正与加载后忽略的权重。' },
  'weights.efficiency': { en: 'Weight of tool calls, latency and tokens.', zh: '工具调用、延迟与 token 的权重。' },
  'thresholds.excellent': { en: 'Total score needed to reach grade A.', zh: '总分达到多少才算 A 级。' },
  'thresholds.good': { en: 'Total score needed to reach grade B.', zh: '总分达到多少才算 B 级。' },
  'thresholds.pass': { en: 'Total score needed to reach grade C.', zh: '总分达到多少才算 C 级。' },
  minSamples: { en: 'Loads before an interval and grade become stable.', zh: '达到多少加载后区间与等级才算稳定。' },
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
  pruneMinLoads: { en: 'Loads required before a prune recommendation appears.', zh: '出现剪枝建议前所需的加载次数。' },
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
  promptHint: {
    en: 'One-line system-prompt hint; off means zero fixed token cost.',
    zh: '系统提示里的单行提示；关闭即零固定 token 成本。',
  },
  reportOnTurnEnd: {
    en: 'Write latest.md/latest.json after each settled turn.',
    zh: '每个结算回合后写 latest.md/latest.json。',
  },
}
const FIELD_UNIT = {
  'weights.static': '%',
  'weights.reliability': '%',
  'weights.effectiveness': '%',
  'weights.efficiency': '%',
  minSamples: 'loads',
  windowTtlMs: 'ms',
  tokenBudgetPerLoad: 'tokens',
  pruneMinLoads: 'loads',
  editBudgetMax: 'edits',
  editBudgetMin: 'edits',
  editBudgetHorizon: 'edits',
  mcpP95Ms: 'ms',
}
for (const field of SETTINGS_FIELDS) {
  const help = FIELD_HELP[field.key]
  if (help) {
    field.help = help.en
    field.helpZh = help.zh
  }
  if (FIELD_UNIT[field.key]) field.unit = FIELD_UNIT[field.key]
}

const FIELD_BY_KEY = new Map(SETTINGS_FIELDS.map((field) => [field.key, field]))

/** Units are stored in English; the Chinese page and the in-panel form use these. */
export const UNIT_ZH = { loads: '次加载', tokens: 'token', edits: '次修改' }

export function unitLabel(unit, zh) {
  if (!unit) return ''
  return zh ? (UNIT_ZH[unit] ?? unit) : unit
}

export const SETTINGS_GROUPS = [
  {
    title: 'Scoring',
    titleZh: '评分权重与阈值',
    keys: SETTINGS_FIELDS.filter(
      (field) =>
        /^(weights|thresholds|minSamples|ciResamples|maxAdvice)\./.test(field.key) ||
        ['minSamples', 'maxAdvice', 'ciResamples'].includes(field.key),
    ).map((field) => field.key),
  },
  { title: 'Cost', titleZh: '成本', keys: ['tokenBudgetPerLoad', 'cacheReadWeight', 'countTokens'] },
  {
    title: 'Advice & lifecycle',
    titleZh: '建议与生命周期',
    keys: [
      'adviceNoiseFloor',
      'windowTtlMs',
      'pruneMinLoads',
      'pruneMaxScore',
      'editBudgetMax',
      'editBudgetMin',
      'editBudgetHorizon',
      'noveltyWindow',
    ],
  },
  { title: 'MCP', titleZh: 'MCP', keys: ['mcpErrorRatePercent', 'mcpP95Ms'] },
  { title: 'Output', titleZh: '输出', keys: ['promptHint', 'reportOnTurnEnd'] },
]

const GROUP_BY_KEY = new Map()
for (const group of SETTINGS_GROUPS) for (const key of group.keys) GROUP_BY_KEY.set(key, group)
for (const field of SETTINGS_FIELDS) {
  const group = GROUP_BY_KEY.get(field.key)
  if (group) {
    field.group = group.title
    field.groupZh = group.titleZh
  }
}

export const FIELD_ZH = {
  'weights.static': '权重：静态质量',
  'weights.reliability': '权重：可靠性',
  'weights.effectiveness': '权重：有效性',
  'weights.efficiency': '权重：效率',
  'thresholds.excellent': 'A 级下限',
  'thresholds.good': 'B 级下限',
  'thresholds.pass': 'C 级下限',
  minSamples: '给区间所需最小样本',
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
  mcpP95Ms: 'MCP p95 告警 (ms)',
  adviceNoiseFloor: '建议噪声地板',
  countTokens: '采集 token 用量',
  promptHint: '注入提示词',
  reportOnTurnEnd: '每回合写快照',
}

const SET = (target, keyPath, value) => {
  const [head, leaf] = keyPath.split('.')
  if (leaf) {
    target[head] = { ...(target[head] ?? {}), [leaf]: value }
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
export function normalizeSettings(input) {
  const values = {}
  const errors = []
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
    if (num < field.min || num > field.max) {
      errors.push({ key, message: `out of range ${field.min}..${field.max}` })
      continue
    }
    values[key] = num
  }
  const weights = ['static', 'reliability', 'effectiveness', 'efficiency'].filter(
    (name) => typeof values[`weights.${name}`] === 'number',
  )
  if (weights.length === 4) {
    const sum = weights.reduce((total, name) => total + values[`weights.${name}`], 0)
    if (sum <= 0) errors.push({ key: 'weights.total', message: 'weights sum must be positive' })
  }
  return { values, errors }
}

/** Read the override file; missing or unreadable means "no overrides". */
/**
 * Parse an HTML form body. Unchecked checkboxes are simply absent from a form
 * POST, so booleans must default to false — otherwise "turn this off" can
 * never be saved from the plain web settings page.
 */
export function parseFormSettings(body) {
  const submitted = Object.fromEntries(new URLSearchParams(body ?? ''))
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

export async function loadSettings(dataDir) {
  if (typeof dataDir !== 'string' || dataDir.length === 0) return {}
  try {
    const raw = await readFile(path.join(dataDir, 'settings.json'), 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

let saveQueue = Promise.resolve()

function enqueueSettingsWrite(dataDir, resolveValues) {
  const file = path.join(dataDir, 'settings.json')
  const job = saveQueue.then(async () => {
    // Resolve inside the queue: a read-merge-write (updateSettings) must see
    // the result of the previous job, not the stale file from before it.
    const values = await resolveValues()
    const temp = `${file}.tmp`
    await ensurePrivateDir(dataDir)
    await writeFile(temp, `${JSON.stringify(values, null, 2)}\n`, 'utf8')
    await rename(temp, file)
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
export function saveSettings(dataDir, values) {
  return enqueueSettingsWrite(dataDir, () => values)
}

/**
 * Merge a partial patch into the settings file inside the write queue. Two
 * overlapping HTTP saves must not both read the pre-update file and drop each
 * other's field; the whole read-merge-write therefore runs as one queued job.
 */
export function updateSettings(dataDir, patch) {
  return enqueueSettingsWrite(dataDir, async () => ({
    ...(await loadSettings(dataDir)),
    ...(patch && typeof patch === 'object' ? patch : {}),
  }))
}

/** Synchronous variant used at plugin apply time (the config must exist first). */
export function loadSettingsSync(dataDir) {
  if (typeof dataDir !== 'string' || dataDir.length === 0) return {}
  try {
    const parsed = JSON.parse(readFileSync(path.join(dataDir, 'settings.json'), 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/** Merge flat override keys into a config-shaped object (mutates and returns it). */
export function applySettings(target, values) {
  for (const [key, value] of Object.entries(values ?? {})) {
    if (!FIELD_BY_KEY.has(key)) continue
    SET(target, key, value)
  }
  return target
}

/** Current effective value for one field, from a config-shaped object. */
export function readSetting(config, key) {
  const [head, leaf] = key.split('.')
  if (leaf) return config?.[head]?.[leaf]
  return config?.[head]
}

/** Render the configuration page. */
export function renderConfigHtml({ config, base, saved = false, errors = [], lang = 'en' }) {
  const zh = lang === 'zh'
  const label = (def) => (zh && FIELD_ZH[def.key] ? FIELD_ZH[def.key] : def.label)
  const groupTitle = (group) => (zh && group.titleZh ? group.titleZh : group.title)
  const field = (def) => {
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
        .filter(Boolean)
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
