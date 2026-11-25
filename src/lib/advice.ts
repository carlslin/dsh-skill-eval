/**
 * Rule-based optimization advice. Every rule is anchored to a measured signal
 * (and carries the evidence that triggered it) so the receiving agent can act
 * on it instead of being told "improve the skill".
 *
 * severity: 'critical' | 'warning' | 'info'
 */

import { bootstrapCallRate, bootstrapRate } from './score.ts'
import { escapeMdInline } from './html.ts'
import type { Stats } from './score.ts'
import type { Advice, Interval, Severity, WindowRecord } from './types.ts'

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

/**
 * Chinese copy for every rule title/fix. Evidence stays measured data (ids,
 * counts, percentages), so it is deliberately not translated. `{server}` and
 * `{tool}` are filled from the rule item at build time.
 */
const ADVICE_ZH: Record<string, { title: string; fix: string }> = {
  'load-failed': {
    title: '技能在运行时加载失败',
    fix: '复现失败的加载（front-matter 非法、缺 SKILL.md、资源目录不可读），修好技能，让 `skill` 工具能返回内容。',
  },
  'post-load-errors': {
    title: '加载该技能后工具错误激增',
    fix: '把正文假设的命令/路径写全，加一段预检，并给出有记录的回退路径，让模型加载后不再靠猜。',
  },
  'token-cost': {
    title: '加载该技能占用的策略 token 过多',
    fix: '砍掉注入内容（精简正文、把细节移到 references/），或让它在任务更晚的阶段才激活；成本必须由实测收益覆盖。',
  },
  'loop-errors': {
    title: '加载该技能后 agent 循环中断',
    fix: '正文把模型带进了不可达状态（不存在的工具/命令、无法执行的指令）。核对正文点名的每个工具与命令，删掉循环执行不了的步骤。',
  },
  'llm-retries': {
    title: '模型请求持续失败并重试',
    fix: '通常是加载的技能把上下文顶出窗口，或产生格式错误的工具调用；精简正文与引用，或拆分技能。',
  },
  'user-corrections': {
    title: '用户在该技能运行后立即否定结果',
    fix: '正文很可能忽略了已声明的约束。收紧输出契约和"不要做什么"清单，并加一段回答前的自检。',
  },
  'negative-feedback': {
    title: '用户明确点了“不满意”',
    fix: '先看反馈分类：如果是输出错误，收紧输出契约与自检；如果是不适用，补反触发；如果是太慢/太贵，精简正文或延后加载。',
  },
  'approval-friction': {
    title: '该技能运行伴随着审批被拒',
    fix: '正文在教模型做需要审批（或被拒）的操作。把它改成只读/可回滚的步骤，或在正文里写明需要的授权与替代路径。',
  },
  'context-compaction': {
    title: '加载该技能后上下文被压缩',
    fix: '技能正文或它带出的工具结果把上下文顶爆了。把长参考资料移到 references/，让默认加载保持精简，或拆成更小的技能。',
  },
  'catalog-truncated': {
    title: '描述超出模型目录上限，后半段从未被看到',
    fix: '把最重要的触发线索（做什么、何时用、反触发）放进前 500 个字符；超出部分移到正文或 references/。',
  },
  'catalog-incomplete': {
    title: '技能目录发现不完整',
    fix: '某个 provider 读取失败，当前分数只覆盖看得见的技能。修复加载失败的技能目录/权限后重测，别把这轮当完整基线。',
  },
  'edit-regression': {
    title: '最近一次修改后分数显著下降',
    fix: '回退这次修改，或缩小改动范围一次只改一个维度；用改前/改后的窗口重新验证，不要继续叠加新改动。',
  },
  'edit-improved': {
    title: '最近一次修改有效',
    fix: '保留这次修改，按同一方向继续；下一条建议应针对仍未解决的维度，而不是重复改同一个地方。',
  },
  'edit-unmeasured': {
    title: '修改后还没有足够的复测样本',
    fix: '再用这个技能跑几次（至少 minSamples 次），让改前/改后的对比有统计意义，再决定保留还是回退。',
  },
  'dead-load': {
    title: '加载的技能经常被忽略',
    fix: '让技能首屏变成命令式清单（“第 1 步用工具 Y 做 X”）。只讲背景的正文会被读完就丢。',
  },
  'trigger-collision': {
    title: '触发面与另一个技能重叠',
    fix: '把它和冲突技能的 description/whenToUse 区分开，并加明确的反触发（“不要用于 …”）。',
  },
  'verbose-execution': {
    title: '执行时工具调用过多',
    fix: '把重复步骤收进 scripts/ 写成一个脚本，让技能只调用一次，而不是每次重新推导流程。',
  },
  'slow-load': {
    title: '加载该技能很慢',
    fix: '技能文件可能太大。把示例/参考资料移到 references/，让默认加载保持精简。',
  },
  'prune-candidate': {
    title: '该技能的成本高于收益——删除或合并',
    fix: '删除这个技能，或把它仍然有用的那一步并入真正被使用的技能。持续低分的技能每次加载都在消耗上下文并稀释触发精度。',
  },
  'body-too-long': {
    title: '技能正文超过 500 行的建议上限',
    fix: '拆到 `references/*.md` 按需加载，顶层正文只做路由。',
  },
  'weak-description': {
    title: '描述太短，无法稳定触发',
    fix: '在 description 本身（不只是正文）写清能力、适用场景和操作对象。',
  },
  'no-trigger-language': {
    title: '描述从未说明何时使用该技能',
    fix: '补一个 “Use when …” 分句，写上应当触发它的具体用户话术。',
  },
  'no-progressive-disclosure': {
    title: '所有内容都堆在一个文件里',
    fix: '长参考资料移到 `references/`，可执行步骤移到 `scripts/`，再从正文指向它们。',
  },
  'no-example': {
    title: '没有具体示例',
    fix: '加一个最小可运行示例；模型照抄示例的可靠性远高于遵循散文。',
  },
  'broken-references': {
    title: '技能引用了不存在的文件',
    fix: '补上缺失文件或修正路径。把模型指向不存在的引用会浪费上下文，通常以猜测作答收场。',
  },
  'no-anti-trigger': {
    title: '没有明确的“不适用”边界',
    fix: '加一行：“Do not use for X / 不适用于 Y”。明确的反触发是触发精度的静态一半。',
  },
  'bad-skill-name': {
    title: '技能 id 不是 kebab-case',
    fix: '改成小写单词用连字符连接（agentskills.io 约定）；不合规 id 会破坏跨客户端发现。',
  },
  'placeholder-text': {
    title: '正文残留占位符',
    fix: '解决或删除占位符；模型会把它们当成自由发挥的许可。',
  },
  'unresolved-skill': {
    title: '无法解析技能定义',
    fix: '先确认技能仍存在，再依据运行时数字行动。',
  },
  'low-sample': {
    title: '证据还不足',
    fix: '把分数当作临时值；保持插件启用，等更多运行后再读。',
  },
  'mcp-server-errors': {
    title: 'MCP 服务器 “{server}” 的调用失败率偏高',
    fix: '检查服务器进程（鉴权 token、启动命令、版本）以及工具 schema 是否仍然匹配；死掉的服务器会悄悄烧掉整轮运行。',
  },
  'mcp-server-slow': {
    title: 'MCP 服务器 “{server}” 尾部延迟高',
    fix: '优先用该服务器上最便宜的工具、缓存结果，或把调用移出关键路径；p95 3 秒+ 的工具会把一步变成一分钟。',
  },
  'mcp-tool-errors': {
    title: 'MCP 工具 “{server}/{tool}” 不可靠',
    fix: '检查该技能传给它参数；schema 不匹配是反复失败的常见原因。',
  },
  'mcp-tool-slow': {
    title: 'MCP 工具 “{server}/{tool}” 尾部慢',
    fix: '传更窄的参数（过滤、limit）、复用结果，或每轮只调一次；尾部延迟才是把聊天变成等待的原因。',
  },
}

function withZhCopy(item: Advice): Advice {
  const zh = ADVICE_ZH[item.id]
  if (!zh) return item
  const fill = (text: string) => text.replaceAll('{server}', item.server ?? '').replaceAll('{tool}', item.tool ?? '')
  return { ...item, titleZh: fill(zh.title), fixZh: fill(zh.fix) }
}

/** Pick the display text for one advice item. */
export function localizeAdvice<T extends Advice | null | undefined>(item: T, lang: unknown): T {
  if (!item || lang !== 'zh' || !item.titleZh) return item
  return { ...item, title: item.titleZh, fix: item.fixZh ?? item.fix }
}

interface LocalizableReport {
  skills?: Array<{ advice?: Advice[]; topAdvice?: Advice[] }>
  mcpAdvice?: Advice[]
  ranking?: { note?: string | null; noteZh?: string } | null
  validity?: { canSay?: unknown; canSayZh?: unknown; cannotSay?: unknown; cannotSayZh?: unknown } | null
}

/** Localize every advice list in a report (used by the HTML board). */
export function localizeReport<R extends LocalizableReport>(report: R, lang: unknown): R {
  if (!report || lang !== 'zh') return report
  const loc = (item: Advice) => localizeAdvice(item, lang)
  return {
    ...report,
    skills: (report.skills ?? []).map((skill) => ({
      ...skill,
      advice: (skill.advice ?? []).map(loc),
      topAdvice: (skill.topAdvice ?? []).map(loc),
    })),
    mcpAdvice: (report.mcpAdvice ?? []).map(loc),
    ranking: report.ranking
      ? { ...report.ranking, note: report.ranking.noteZh ?? report.ranking.note }
      : report.ranking,
    validity: report.validity
      ? {
          ...report.validity,
          canSay: report.validity.canSayZh ?? report.validity.canSay,
          cannotSay: report.validity.cannotSayZh ?? report.validity.cannotSay,
        }
      : report.validity,
  } as R
}

function pct(x: number | null | undefined): string {
  return x === null || x === undefined ? 'n/a' : `${Math.round(x * 100)}%`
}

function num(x: unknown, digits = 1): string {
  return x === null || x === undefined ? 'n/a' : Number(x).toFixed(digits)
}

function topKeys(map: Record<string, number> | null | undefined, limit = 3): string[] {
  return Object.entries(map ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => `${k}×${v}`)
}

interface StaticInput {
  resolved?: boolean
  name?: string
  description?: string
  catalogDescription?: string
  catalogTruncated?: boolean
  catalogComplete?: boolean
  modelInvocable?: boolean
  bodyLines?: number
  integrity?: { checked?: number; missing?: string[] } | null
  failedChecks?: Array<{ id: string; fraction: number }>
}

type Gate = { level: 'strong' | 'mean' | 'weak' | 'none'; ci: Interval | null }

/**
 * Noise-floor gate: keep the rule's severity only when the measured rate is
 * already outside the bootstrap interval at that threshold. Otherwise report it
 * as info ("not outside noise yet") instead of asking for a fix on noise.
 */
function gated(
  windows: WindowRecord[] | null | undefined,
  isHit: (w: WindowRecord) => boolean,
  threshold: number,
  resamples: number,
): Gate {
  // No window-level evidence: keep the historical behaviour (report the mean).
  if (!Array.isArray(windows) || windows.length === 0) return { level: 'strong', ci: null }
  // Small-n bootstrap intervals are overconfident (n=2 all-hits yields
  // [1,1] instead of the true [0.16,1.0]): compute the interval normally but
  // cap the verdict at weak so small samples can never report strong/critical.
  if (Array.isArray(windows) && windows.length > 0 && windows.length < 8) {
    const ci = bootstrapRate(windows, isHit, { resamples, seed: 17 })
    if (!ci) return { level: 'mean', ci: null }
    if (ci.mean <= threshold) return { level: 'none', ci }
    return { level: 'weak', ci }
  }
  const ci = bootstrapRate(windows, isHit, { resamples, seed: 17 })
  if (!ci) return { level: 'mean', ci: null }
  if (ci.low > threshold) return { level: 'strong', ci }
  if (ci.mean > threshold) return { level: 'weak', ci }
  return { level: 'none', ci }
}

function gatedCalls(windows: WindowRecord[] | null | undefined, threshold: number, resamples: number): Gate {
  if (!Array.isArray(windows) || windows.length === 0) return { level: 'strong', ci: null }
  if (windows.length < 8) {
    const ci = bootstrapCallRate(windows, { resamples, seed: 17 })
    if (!ci) return { level: 'mean', ci: null }
    if (ci.mean <= threshold) return { level: 'none', ci }
    return { level: 'weak', ci }
  }
  const ci = bootstrapCallRate(windows, { resamples, seed: 17 })
  if (!ci) return { level: 'mean', ci: null }
  if (ci.low > threshold) return { level: 'strong', ci }
  if (ci.mean > threshold) return { level: 'weak', ci }
  return { level: 'none', ci }
}

function noiseNote(ci: Interval | null, threshold: number, level: Gate['level']): string {
  if (!ci) return ''
  const base = ` (95% interval ${Math.round(ci.low * 100)}-${Math.round(ci.high * 100)}%, threshold ${Math.round(
    threshold * 100,
  )}%`
  return level === 'strong' ? `${base})` : `${base} — not outside noise yet)`
}

export function buildAdvice({
  stats,
  static: sp,
  score,
  minSamples = 3,
  windows,
  editImpact = null,
  gating = true,
  tokenBudgetPerLoad = 20000,
  pruneMinLoads = 6,
  pruneMaxScore = 60,
}: {
  stats: Stats
  static?: StaticInput | null
  // the other score fields (dimensions, grade, ...) are accepted and ignored
  score?: { total?: number | null; ci?: { low: number | null; high: number } | null; [field: string]: unknown } | null
  minSamples?: number
  windows?: WindowRecord[] | null
  editImpact?: {
    before: { score: number | null; loads: number }
    after: { score: number | null; loads: number }
    delta: number | null
    significant: boolean
    direction: 'improved' | 'regressed' | 'flat' | 'insufficient'
    dimension: string | null
    hypothesis: string | null
  } | null
  gating?: boolean
  tokenBudgetPerLoad?: number
  pruneMinLoads?: number
  pruneMaxScore?: number
}): Advice[] {
  const out: Advice[] = []
  const strong: Gate = { level: 'strong', ci: null }
  const gate = (isHit: (w: WindowRecord) => boolean, threshold: number) =>
    gating ? gated(windows, isHit, threshold, 400) : strong

  // ---- runtime evidence rules -------------------------------------------

  if (stats.loadErrors.length > 0) {
    out.push({
      id: 'load-failed',
      severity: 'critical',
      dimension: 'reliability',
      title: 'Skill load fails at runtime',
      evidence: `${stats.loads - stats.loadOk}/${stats.loads} loads returned an error: ${stats.loadErrors
        .slice(-3)
        .map((e) => escapeMdInline(e, 120))
        .join(' | ')}`,
      fix: 'Reproduce the failing load (invalid front-matter, missing SKILL.md, unreadable resource base) and repair the skill so the `skill` tool returns content.',
    })
  }

  // Gate on the same call-weighted rate the evidence reports.
  const errGate = gating ? gatedCalls(windows, 0.25, 400) : strong
  if (stats.errRate !== null && stats.errRate > 0.25 && errGate.level !== 'none') {
    out.push({
      id: 'post-load-errors',
      severity: errGate.level === 'strong' ? 'critical' : 'info',
      dimension: 'reliability',
      title: 'Tool errors spike after this skill is loaded',
      evidence: `${pct(stats.errRate)} of the ${stats.toolCalls} tool calls inside the window failed${noiseNote(errGate.ci, 0.25, errGate.level)}${
        Object.keys(stats.errorNames).length ? ` (${topKeys(stats.errorNames).join(', ')})` : ''
      }`,
      fix: 'Add the exact commands/paths the body assumes, a preflight check section, and a documented fallback path, so the model stops guessing after loading.',
    })
  }

  if (stats.tokensPerLoad !== null && stats.tokenWindows >= 3 && stats.tokensPerLoad > tokenBudgetPerLoad * 1.25) {
    out.push({
      id: 'token-cost',
      severity: 'warning',
      dimension: 'efficiency',
      title: 'Loading this skill is expensive in policy tokens',
      evidence: `about ${Math.round(stats.tokensPerLoad).toLocaleString()} billable tokens per load across ${
        (stats.tokens && stats.tokens.calls) || 0
      } model call(s) (budget ${Math.round(tokenBudgetPerLoad).toLocaleString()})`,
      fix: 'Cut what the skill injects (trim the body, move detail to references/) or make it activate later in the task; cost must be paid for by measured gain.',
    })
  }

  if (stats.loopErrorRate !== null && stats.loopErrorRate > 0.2) {
    const loopGate = gate((w) => (w.loopErrors || 0) > 0, 0.2)
    if (loopGate.level !== 'none') {
      out.push({
        id: 'loop-errors',
        severity: loopGate.level === 'strong' ? 'critical' : 'info',
        dimension: 'reliability',
        title: 'The agent loop breaks after this skill is loaded',
        evidence: `${pct(stats.loopErrorRate)} of runs hit an agent-loop error after the load${
          Object.keys(stats.loopErrorNames ?? {}).length ? ` (${topKeys(stats.loopErrorNames).join(', ')})` : ''
        }${noiseNote(loopGate.ci, 0.2, loopGate.level)}`,
        fix: 'The body is steering the model into an unreachable state (a tool or command that does not exist, an instruction that cannot be followed). Check every tool/command the body names and remove steps the loop cannot execute.',
      })
    }
  }

  if (stats.llmRetries > 0 && stats.closed >= 3 && stats.closed > 0 && stats.llmRetries / stats.closed >= 2) {
    out.push({
      id: 'llm-retries',
      severity: 'warning',
      dimension: 'reliability',
      title: 'Model requests keep failing and retrying inside the run',
      evidence: `${stats.llmRetries} retried model request(s) across ${stats.closed} run(s)`,
      fix: 'Usually the loaded skill pushes the context over the window or emits a malformed tool call; trim the body and its references, or split the skill.',
    })
  }

  const correctionGate = gate((w) => (w.corrections?.length ?? 0) > 0, 0.3)
  if (stats.correctionRate !== null && stats.correctionRate > 0.3 && correctionGate.level !== 'none') {
    out.push({
      id: 'user-corrections',
      severity: correctionGate.level === 'strong' ? 'critical' : 'info',
      dimension: 'effectiveness',
      title: 'The user rejects the result right after the skill runs',
      evidence: `${pct(stats.correctionRate)} of runs were followed by a correcting message (e.g. “${
        escapeMdInline(stats.corrections[0] ?? '', 80) ?? ''
      }”)${noiseNote(correctionGate.ci, 0.3, correctionGate.level)}`,
      fix: 'The body likely ignores stated constraints. Tighten the output contract and the "do not" list; add a short self-check the model must run before answering.',
    })
  }

  // stats.abandonRate is judged on root windows only (subagent runs excluded,
  // evicted windows censored): the noise gate must resample the same base.
  const roots = (windows ?? []).filter((w) => w && w.origin !== 'subagent')
  const abandonWindows = (roots.length > 0 ? roots : (windows ?? [])).filter((w) => w && w.closeReason !== 'evicted')
  const abandonGate = gating ? gated(abandonWindows, (w) => (w.toolCalls || 0) === 0, 0.3, 400) : strong
  if (stats.abandonRate !== null && stats.abandonRate > 0.3 && abandonGate.level !== 'none') {
    out.push({
      id: 'dead-load',
      severity: abandonGate.level === 'strong' ? 'warning' : 'info',
      dimension: 'effectiveness',
      title: 'Loaded skills are often ignored',
      evidence: `${pct(stats.abandonRate)} of runs made zero tool calls after the load and produced no follow-through${noiseNote(abandonGate.ci, 0.3, abandonGate.level)}`,
      fix: 'Make the first screen of the skill an imperative checklist ("step 1 do X with tool Y"). A body that only explains background gets read and dropped.',
    })
  }

  const siblingGate = gate((w) => (w.otherSkills?.length ?? 0) > 0, 0.3)
  if (stats.siblingRate !== null && stats.siblingRate > 0.3 && siblingGate.level !== 'none') {
    out.push({
      id: 'trigger-collision',
      severity: siblingGate.level === 'strong' ? 'warning' : 'info',
      dimension: 'effectiveness',
      title: 'Trigger surface overlaps another skill',
      evidence: `${pct(stats.siblingRate)} of runs loaded another skill in the same window: ${topKeys(
        stats.siblings,
      ).join(', ')}${noiseNote(siblingGate.ci, 0.3, siblingGate.level)}`,
      fix: 'Differentiate the description/whenToUse from the colliding skill and add explicit anti-triggers ("do not use for …").',
    })
  }

  if (stats.avgCalls !== null && stats.avgCalls > 8) {
    out.push({
      id: 'verbose-execution',
      severity: 'info',
      dimension: 'efficiency',
      title: 'Execution is tool-call heavy',
      evidence: `average ${num(stats.avgCalls)} tool calls per run after load`,
      fix: 'Bundle the repetitive steps into a script under `scripts/` and have the skill call it once instead of describing a procedure to re-derive each run.',
    })
  }

  if (stats.p50LoadMs !== null && stats.p50LoadMs > 2000) {
    out.push({
      id: 'slow-load',
      severity: 'info',
      dimension: 'efficiency',
      title: 'Loading the skill is slow',
      evidence: `median load ${num(stats.p50LoadMs, 0)} ms`,
      fix: 'The skill file is probably very large. Move examples/reference material into `references/` so the default load stays small.',
    })
  }

  // ---- pruning (RRSI: components that stop earning their place are removed) ----
  // Deletion advice is destructive: require a real sample (default 12, never
  // below 6), a bootstrap interval that stays below the bar, and never fire on
  // point estimates alone (ciResamples=0 disables intervals → no prune).
  const total = typeof score?.total === 'number' ? score.total : null
  const ci = score?.ci ?? null
  const effectivePruneMin = Math.max(6, pruneMinLoads)
  if (
    total !== null &&
    stats.loads >= effectivePruneMin &&
    total < pruneMaxScore &&
    ci &&
    typeof ci.high === 'number' &&
    ci.high < pruneMaxScore + 5
  ) {
    out.push({
      id: 'prune-candidate',
      severity: 'critical',
      dimension: 'lifecycle',
      title: 'This skill costs more than it pays back — prune or merge it',
      evidence: `${stats.loads} load(s), score ${total}/100${ci ? ` (95% interval ${ci.low}-${ci.high})` : ''}, corrections ${pct(
        stats.correctionRate,
      )}, ignored ${pct(stats.abandonRate)}`,
      fix: 'Delete the skill, or fold the one step that still helps into the skill that actually gets used. Keeping a consistently low-scoring skill spends context on every load and dilutes trigger precision.',
    })
  }

  // ---- authoring (static) rules ----------------------------------------

  if (sp) {
    if (sp.catalogTruncated) {
      out.push({
        id: 'catalog-truncated',
        severity: 'warning',
        dimension: 'static',
        title: 'Description is cut off in the model catalog',
        evidence:
          'raw description is ' +
          String(sp.description ?? '').length +
          ' chars but the model only sees ' +
          String(sp.catalogDescription ?? '').length +
          ' (whitespace-normalized, catalog-capped)',
        fix: 'Put the essential trigger cues in the first 500 characters; move the rest into the body or references/. Text past the cap cannot affect routing.',
      })
    }
    if (sp.catalogComplete === false) {
      out.push({
        id: 'catalog-incomplete',
        severity: 'info',
        dimension: 'confidence',
        title: 'Skill catalog discovery was incomplete',
        evidence:
          'at least one provider failed discovery when this profile was captured; scores cover the visible skills only',
        fix: 'Fix the failing skill root/permissions and re-measure before treating this round as a complete baseline.',
      })
    }
    for (const check of sp.failedChecks ?? []) {
      if (check.id === 'body-compact' && check.fraction <= 0.5) {
        out.push({
          id: 'body-too-long',
          severity: 'warning',
          dimension: 'static',
          title: 'Skill body exceeds the 500-line guidance',
          evidence: `${sp.bodyLines} lines of body`,
          fix: 'Split into `references/*.md` loaded on demand and keep the top-level body as a router.',
        })
      }
      if (check.id === 'desc-length' && check.fraction < 1) {
        out.push({
          id: 'weak-description',
          severity: 'warning',
          dimension: 'static',
          title: 'Description is too short to trigger reliably',
          evidence: `description is ${String(sp.catalogDescription ?? sp.description ?? '').length} chars as rendered in the catalog`,
          fix: 'State the capability, the situation that calls for it, and the objects it operates on — in the description itself, not only in the body.',
        })
      }
      if (check.id === 'desc-trigger' && check.fraction < 1) {
        out.push({
          id: 'no-trigger-language',
          severity: 'warning',
          dimension: 'static',
          title: 'Description never says when to use the skill',
          evidence: `description: “${String(sp.catalogDescription ?? sp.description ?? '').slice(0, 120)}”`,
          fix: 'Add a "Use when …" clause with the concrete user phrasings that should activate it.',
        })
      }
      if (check.id === 'progressive-disclosure' && check.fraction < 1) {
        out.push({
          id: 'no-progressive-disclosure',
          severity: 'info',
          dimension: 'static',
          title: 'Everything lives in one file',
          evidence: 'no `references/`, `scripts/` or `assets/` usage detected',
          fix: 'Move long reference material to `references/` and executable steps to `scripts/`, then point at them from the body.',
        })
      }
      if (check.id === 'has-example' && check.fraction < 1) {
        out.push({
          id: 'no-example',
          severity: 'info',
          dimension: 'static',
          title: 'No concrete example',
          evidence: 'no fenced code block in the body',
          fix: 'Add one minimal worked example; models copy examples far more reliably than they follow prose.',
        })
      }
      if (check.id === 'reference-integrity' && check.fraction < 1) {
        const missing = (sp.integrity && sp.integrity.missing) || []
        out.push({
          id: 'broken-references',
          severity: 'critical',
          dimension: 'static',
          title: 'The skill references files that do not exist',
          evidence: `missing: ${missing.slice(0, 5).join(', ') || 'referenced paths not found'} (${sp.integrity?.checked ?? 0} referenced)`,
          fix: 'Create the missing files or fix the paths. A body that sends the model to a nonexistent reference wastes the scene and usually ends in a guessed answer.',
        })
      }
      if (check.id === 'anti-trigger' && check.fraction < 1) {
        out.push({
          id: 'no-anti-trigger',
          severity: 'info',
          dimension: 'static',
          title: 'No explicit "not for this" boundary',
          evidence: 'description and body never state when the skill should not be used',
          fix: 'Add one line: "Do not use for X / 不适用于 Y". Explicit anti-triggers are the static half of trigger precision.',
        })
      }
      if (check.id === 'skill-name' && check.fraction < 1) {
        out.push({
          id: 'bad-skill-name',
          severity: 'warning',
          dimension: 'static',
          title: 'Skill id is not kebab-case',
          evidence: `id: ${sp.name}`,
          fix: 'Rename to lowercase words joined by hyphens (agentskills.io contract); non-conforming ids break cross-client discovery.',
        })
      }
      if (check.id === 'no-placeholder' && check.fraction < 1) {
        out.push({
          id: 'placeholder-text',
          severity: 'warning',
          dimension: 'static',
          title: 'Placeholder text left in the body',
          evidence: 'TODO/TBD/FIXME/XXX present',
          fix: 'Resolve or delete placeholders; a model treats them as licence to improvise.',
        })
      }
    }
  } else {
    out.push({
      id: 'unresolved-skill',
      severity: 'info',
      dimension: 'static',
      title: 'Skill definition could not be resolved',
      evidence: 'the skill is not in the current catalog (removed, renamed, or provider offline)',
      fix: 'Confirm the skill still exists before acting on the runtime numbers.',
    })
  }

  if (stats.feedbackTotal >= 2 && (stats.feedbackNegativeRate ?? 0) > 0.4) {
    const categories = Object.entries(stats.feedback.categories ?? {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => name + '×' + count)
    out.push({
      id: 'negative-feedback',
      severity: (stats.feedbackNegativeRate ?? 0) >= 0.6 && stats.feedbackTotal >= 3 ? 'critical' : 'warning',
      dimension: 'effectiveness',
      title: 'Users rate this skill negatively',
      evidence:
        String(stats.feedback.negative) +
        '/' +
        String(stats.feedbackTotal) +
        ' explicit ratings are negative' +
        (categories.length ? ' (' + categories.join(', ') + ')' : '') +
        ' — measured from DSH message feedback, not text heuristics',
      fix: 'Read the feedback categories first: for wrong output tighten the output contract and self-check; for "not applicable" add anti-triggers; for slow/expensive trim the body or defer the load.',
    })
  }

  if (stats.approvals.rejected >= 2 && stats.approvals.decided > 0) {
    out.push({
      id: 'approval-friction',
      severity: 'warning',
      dimension: 'effectiveness',
      title: 'Work from this skill keeps getting denied at approval',
      evidence:
        String(stats.approvals.rejected) +
        '/' +
        String(stats.approvals.decided) +
        ' decided approvals were rejected (' +
        String(stats.approvals.asked) +
        ' asked)',
      fix: 'The body likely teaches an action that needs permission or gets refused. Make the default path read-only/reversible, or state the required authorization and the fallback explicitly.',
    })
  }

  if (stats.compactions >= 2 && (stats.compactionPerLoad ?? 0) >= 0.25) {
    out.push({
      id: 'context-compaction',
      severity: 'warning',
      dimension: 'efficiency',
      title: 'Loading this skill triggers context compaction',
      evidence:
        String(stats.compactions) +
        ' compaction(s) across ' +
        String(stats.compactionWindows) +
        ' window(s), ' +
        String(stats.closed) +
        ' closed load(s)',
      fix: 'Move long reference material to references/ and keep the loaded body small; a skill that forces compaction costs the whole window working memory.',
    })
  }

  if (editImpact) {
    const before = editImpact.before
    const after = editImpact.after
    const delta = editImpact.delta
    const scope =
      String(before.loads) +
      ' load(s) before → ' +
      String(after.loads) +
      ' after' +
      (editImpact.dimension ? ', dimension ' + editImpact.dimension : '')
    if (editImpact.significant && editImpact.direction === 'regressed') {
      out.push({
        id: 'edit-regression',
        severity: 'warning',
        dimension: 'effectiveness',
        title: 'The latest edit made the score significantly worse',
        evidence:
          'score ' + String(before.score) + ' → ' + String(after.score) + ' (Δ ' + String(delta) + '), ' + scope,
        fix: 'Revert or narrow this edit to one dimension, then re-measure before stacking another change.',
      })
    } else if (editImpact.significant && editImpact.direction === 'improved') {
      out.push({
        id: 'edit-improved',
        severity: 'info',
        dimension: 'effectiveness',
        title: 'The latest edit measurably helped',
        evidence:
          'score ' + String(before.score) + ' → ' + String(after.score) + ' (Δ ' + String(delta) + '), ' + scope,
        fix: 'Keep it and continue in the same direction; target the dimensions that are still unresolved instead of re-editing this one.',
      })
    } else if (before.loads < minSamples || after.loads < minSamples) {
      out.push({
        id: 'edit-unmeasured',
        severity: 'info',
        dimension: 'confidence',
        title: 'The latest edit has not been measured yet',
        evidence: 'not enough windows on one side of the edit: ' + scope,
        fix: 'Run this skill a few more times (at least minSamples) so the before/after comparison has statistical meaning before keeping or reverting the edit.',
      })
    }
  }

  if (stats.loads < minSamples) {
    out.push({
      id: 'low-sample',
      severity: 'info',
      dimension: 'confidence',
      title: 'Not enough evidence yet',
      evidence: `${stats.loads} recorded load(s), ${minSamples} needed for a stable score`,
      fix: 'Treat the score as provisional; keep the plugin enabled and re-read after more runs.',
    })
  }

  const withZh = out.map(withZhCopy)
  withZh.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
  return withZh
}

export function topAdvice(all: readonly Advice[], limit = 5): Advice[] {
  return [...all].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, limit)
}

export interface McpRow {
  server: string
  calls?: number
  errors?: number
  errorRate?: number | null
  p50Ms?: number | null
  p95Ms?: number | null
  tools?: Array<{ tool: string; calls?: number; errors?: number; p50Ms?: number | null; p95Ms?: number | null }>
}

/**
 * MCP servers are shared infrastructure, so their health does not belong to one
 * skill's advice list. These rules run over the aggregated MCP board.
 */
export function buildMcpAdvice(
  servers: readonly McpRow[] | null | undefined,
  options: { errorRate?: number; p95Ms?: number; toolErrorRate?: number; toolP95Ms?: number } = {},
): Advice[] {
  const errorRateLimit = typeof options.errorRate === 'number' ? options.errorRate : 0.2
  const p95LimitMs = typeof options.p95Ms === 'number' ? options.p95Ms : 3000
  const toolErrorRateLimit = typeof options.toolErrorRate === 'number' ? options.toolErrorRate : 0.3
  const toolP95LimitMs = typeof options.toolP95Ms === 'number' ? options.toolP95Ms : 5000
  const out: Advice[] = []
  for (const row of servers ?? []) {
    if (!row || typeof row !== 'object') continue
    const calls = row.calls ?? 0
    const errors = row.errors ?? 0
    const errorRate = typeof row.errorRate === 'number' ? row.errorRate : calls > 0 ? errors / calls : 0
    // Single-call servers (1/1) must not raise critical: require a minimum
    // sample before judging shared infrastructure.
    if (calls >= 5 && errorRate > errorRateLimit) {
      out.push({
        id: 'mcp-server-errors',
        severity: 'critical',
        server: row.server,
        title: `MCP server "${row.server}" fails ${pct(errorRate)} of its calls`,
        evidence: `${errors}/${calls} calls failed`,
        fix: 'Check the server process (auth token, startup command, version) and whether the tool schema still matches; a dead server silently burns the whole run.',
      })
    }
    if (row.p95Ms !== null && row.p95Ms !== undefined && row.p95Ms > p95LimitMs) {
      out.push({
        id: 'mcp-server-slow',
        severity: 'warning',
        server: row.server,
        title: `MCP server "${row.server}" is slow at the tail`,
        evidence: `p50 ${row.p50Ms ?? '—'}ms · p95 ${row.p95Ms}ms`,
        fix: 'Prefer the cheapest tool on this server, cache results, or move the call off the critical path; a 3s+p95 tool turns one step into a minute.',
      })
    }
    for (const tool of row.tools ?? []) {
      const toolCalls = tool.calls ?? 0
      const toolErrors = tool.errors ?? 0
      if (toolCalls >= 2 && toolErrors / toolCalls > toolErrorRateLimit) {
        out.push({
          id: 'mcp-tool-errors',
          severity: 'warning',
          server: row.server,
          tool: tool.tool,
          title: `MCP tool "${row.server}/${tool.tool}" is unreliable`,
          evidence: `${toolErrors}/${toolCalls} calls failed`,
          fix: 'Check the arguments this skill passes to that tool; a schema mismatch is the usual cause of repeated failures.',
        })
      }
      if (toolP95LimitMs > 0 && typeof tool.p95Ms === 'number' && tool.p95Ms > toolP95LimitMs && toolCalls >= 2) {
        out.push({
          id: 'mcp-tool-slow',
          severity: 'warning',
          server: row.server,
          tool: tool.tool,
          title: `MCP tool "${row.server}/${tool.tool}" has a slow tail`,
          evidence: `p50 ${tool.p50Ms ?? '—'}ms · p95 ${tool.p95Ms}ms over ${toolCalls} call(s)`,
          fix: 'Pass narrower arguments (filters, limits), reuse the result, or call it once per run instead of per step; tail latency is what turns a chat into a wait.',
        })
      }
    }
  }
  return out.map(withZhCopy).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
}
