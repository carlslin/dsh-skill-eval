# dsh-skill-eval — design detail

## Why this exists

Every published skill-evaluation tool we looked at is a **static, offline** checker:

| Project                                                                           | What it does                                                                                                                 | What it cannot see                                             |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `aws-samples/sample-agent-skill-eval`                                             | audit (100 − deductions), functional/trigger runs through Claude CLI, weighted report 40/40/20, `.skilleval.yaml`            | nothing about the skill as it is actually used in this harness |
| `NVIDIA/SkillEvaluator`                                                           | T1 static validation (SkillSpector, Gitleaks, Semgrep), T2 embedding dedup, T3 Docker-sandboxed live eval with an LLM rubric | needs a sandboxed re-run, not the real session                 |
| `darkrishabh/agent-skills-eval`, `alibaba/skill-up`, `adewale/skill-eval-harness` | test runners / evolution loops over fixtures                                                                                 | no runtime attachment to a live agent                          |

They all answer "is this skill file well-formed?". None of them can answer
"when this agent loaded this skill in this session, did it actually help?".
That second question is what this plugin measures, because inside DSH it can sit
on the real event stream.

The weighting and banding ideas (multi-dimensional rubric, A–F bands, a ~70
pass line) are borrowed from those projects. No code is copied.

## What is recorded

Two append-only JSONL record types live in `$DSH_HOME/skill-eval/$DSH_PROFILE/events.jsonl`
(override with `dataDir` or `DSH_SKILL_EVAL_DIR`). The session log is **never**
written to — plugins must not append foreign event types to it.

```jsonc
// written when a `skill` tool call completes
{ "t": "skill", "v": 1, "at": 1763, "sessionId": "…", "callId": "…",
  "skill": "pdf-tools", "ok": true, "loadMs": 37, "windowId": "…" }

// written at turn end and again when the window closes
{ "t": "window", "v": 1, "at": 1763, "windowId": "…", "sessionId": "…",
  "skill": "pdf-tools", "toolCalls": 4, "errors": 1, "errorNames": ["ToolError"],
  "corrections": ["不对，页眉没删掉"], "otherSkills": ["docx"], "turnEnded": true,
  "truncated": false, "closeReason": "user-turn" }
```

A **window** is the stretch of work that follows one skill load. It is the unit
of evidence. Readers keep the _last_ record per `windowId`, so the turn-end write
is an update and the close-time write is a second update — durability without
duplicates.

Window lifetime, deliberately unusual:

- opens on a successful `skill` load
- **stays open across the turn boundary** — the evidence that a skill failed is
  usually the next user message ("no, that's wrong"), so closing at turn end
  would throw away the strongest signal. The turn-end write only persists a
  snapshot.
- closes on: the next user message (correction recorded first), a new skill load
  in the same session (the previous skill records the new one as a sibling), TTL
  expiry (`windowTtlMs`, default 30 min), session eviction, or plugin dispose.

## Scoring

```
total = Σ(weightᵢ × dimensionᵢ) / Σ(weightᵢ over dimensions with evidence)
```

| dimension     | weight | source                                                          |
| ------------- | ------ | --------------------------------------------------------------- |
| static        | 0.30   | the live skill catalog (`skills.list` + `skills.get`)           |
| reliability   | 0.25   | load success × post-load tool error rate                        |
| effectiveness | 0.30   | user corrections, ignored loads, sibling collisions, error rate |
| efficiency    | 0.15   | average tool calls per run, median load latency                 |

A dimension with no evidence is dropped and its weight redistributed, so a
brand-new skill is not punished for having no history; `provisional` marks
scores below `minSamples` loads.

### static checks (117 points, normalised)

Twelve weighted checks; checks that cannot be evaluated (no filesystem view,
unresolved references) are marked skipped and dropped from both earned and
total weight, so the static score is always a percentage of what was checkable.

| check                  | weight | rule                                                    |
| ---------------------- | ------ | ------------------------------------------------------- |
| desc-length            | 12     | description length within the useful band               |
| desc-trigger           | 12     | description says _when_ to use the skill                |
| when-to-use            | 8      | `whenToUse` present                                     |
| body-present           | 10     | SKILL.md body resolves and is non-trivial               |
| body-compact           | 18     | ≤ 500 body lines (`1 − (lines − 500)/1000` beyond that) |
| sections               | 10     | ≥ 2 `##` headings                                       |
| progressive-disclosure | 15     | delegates to `references/`, `scripts/` or `assets/`     |
| no-placeholder         | 10     | no TODO/TBD/FIXME/XXX                                   |
| has-example            | 5      | at least one fenced code block                          |
| anti-trigger           | 5      | states when _not_ to use it                             |
| skill-name             | 4      | kebab-case skill id                                     |
| reference-integrity    | 8      | every referenced file exists                            |

### runtime dimensions

```
reliability   = 100 · loadOkRate · (0.6 + 0.4 · (1 − min(1, 2·errRate)))
effectiveness = 100 − 45·correctionRate − 25·abandonRate − 20·siblingRate − 10·errRate
efficiency    = 100 − (avgCalls > 8 ? min(40, (avgCalls−8)·6) : 0) − (avgCalls < 1 ? 15 : 0)
                     − (p50LoadMs > 2000 ? min(30, (p50LoadMs−2000)/100) : 0)
                     − (tokensPerLoad > budget ? min(35, (tokensPerLoad−budget)/budget·30) : 0)
```

A failed load multiplies reliability instead of only halving it: a skill that
cannot be loaded has zero reliability, not 40/100.

Bands: `A ≥ 90`, `B ≥ 80`, `C ≥ 70`, `D ≥ 60`, `F < 60` (configurable via
`thresholds`).

## Advice

`lib/advice.js` is a rule engine over the same numbers. Every rule emits
`{id, severity, dimension, title, evidence, fix}` where `evidence` is the measured
value (or the user's own words) and `fix` is an instruction the agent can execute
against the skill file. Rules:

| id                                                                        | severity | trigger                      |
| ------------------------------------------------------------------------- | -------- | ---------------------------- |
| load-failed                                                               | critical | ≥ 1 failed load              |
| post-load-errors                                                          | critical | errRate > 25 %               |
| user-corrections                                                          | critical | correctionRate > 30 %        |
| dead-load                                                                 | warning  | abandonRate > 30 %           |
| trigger-collision                                                         | warning  | siblingRate > 30 %           |
| verbose-execution                                                         | info     | avgCalls > 8                 |
| slow-load                                                                 | info     | p50LoadMs > 2000             |
| body-too-long / weak-description / no-trigger-language / placeholder-text | warning  | matching static check        |
| no-progressive-disclosure / no-example                                    | info     | matching static check        |
| unresolved-skill / low-sample                                             | info     | catalog miss / too few loads |

## Surfaces

- **Client seats** (`client.js`): the result strip under a completed turn
  (`conversation.chat.turnTail`), the sidebar panel icon plus its main board
  panel (`sidebar.panellist` + `main`), and the native settings form on the
  bundle page (`plugins.bundle.config`). An opt-in debug popup
  (`window.__SEV_ENABLE_POPUP__ = true`) additionally registers
  `sidebar.footer.action` + `shell.overlay`. All surfaces read the same host
  route, so the tool, the board and the popup show the same numbers.
- `skill_eval_report` tool — `{skill?, format?: 'markdown'|'json'}`. Registered
  so the agent can read its own numbers and cite them; a system-prompt section
  tells it to.
- `/skill-eval [skill]` command — the same report in the composer.
- **Turn snapshot** — after a turn settles, a debounced write puts the whole
  aggregated report at `<dataDir>/reports/latest.md` and `latest.json`. Zero
  tokens: it never enters the model context, it is just a file you (or the
  agent, on request) can read.
- `GET /skill-eval` — HTML dashboard served through `webServer` (no build step,
  self-contained, light/dark). `GET /skill-eval/data` returns the raw report
  JSON, and is registered as its own **exact** route so it survives the page
  route failing to re-register after a reload.

A Client half loads only when the host scans the package at boot, so installing
or changing `client.js` needs one DSH restart before the button appears.

## Upgrading without breaking the dashboard

The host keeps `webServer` routes registered by a disposed plugin generation, so
after a hot reload the canonical `/skill-eval/data` can still be answered by the
old handler while the new module is running. Two measures keep that from
silently serving stale numbers:

1. the data API is registered both canonically and under the package version
   (`/skill-eval/data/<version>`), and the versioned path is new on every
   release, so a reload can always serve current data;
2. the popup asks the versioned path first and falls back to the canonical one
   on 404, and a test pins the client constant to `package.json.version`.

`/skill-eval accept` runs the in-process half of the same checks from the
composer (route shape, boards, intervals, snapshot generation, telemetry), and
`node scripts/accept.mjs` checks both routes and reports a generation mismatch
instead of leaving you to guess. The popup does the same from inside: when the
payload it receives has no `scoring`/`ranking` fields it shows a red banner
("the running host serves an older plugin generation … restart DeepSeek
Harness"), so a stale process is visible where the user actually looks.

## Agent-loop wiring

Which loop stages feed the evidence, and which do not:

| loop stage            | event                             | what the plugin does                                                                                           |
| --------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| loop step             | `agent/pre-step` (waterfall)      | records the step number (parallel vs switched loads), then `next()` untouched                                  |
| tool dispatch start   | `tools/pre-execute` (waterfall)   | timestamps `skill` loads only, then `next()` untouched                                                         |
| tool dispatch end     | `tools/result` (emit)             | call/error counting per open window, skill load records, static capture                                        |
| user turn opens       | `agent/inbox/claimed` (emit)      | reads the message for correction language, then closes the windows                                             |
| turn about to close   | `agent/turn-stopping` (serial)    | persists a snapshot, keeps the window open for the follow-up message                                           |
| step/turn error       | `agent/error` (emit)              | `loopErrors` + `lastLoopError` on every open window; costs up to 40% of reliability and raises a critical rule |
| model request failure | `agent/request-error` (waterfall) | `llmRetries` per window, then `next()` untouched (the retry policy stays the host's)                           |

Token accounting **is** wired (`countTokens`): provider usage is attributed to
the open windows and `tokensPerLoad` feeds the efficiency dimension and the
token-cost advice. Deliberately **not** wired yet:

- **compaction** — a mid-window compaction does not break attribution, but the
  window does not record that the model's context was rewritten.
- **turn truncation from max tokens** — a turn that dies on the output limit is
  currently only visible through the following correction or error path.

Every listener above is read-only except the two waterfalls, which always call
`next()`, and every body is wrapped so telemetry can never fail a turn.

## Concurrency and multi-agent work

Measured on the live host with the `workflow` tool (two `agent()` children in one
parallel batch, each loading the same skill):

- every child session produced its own `skill` record (distinct `sessionId`,
  its own `loadMs`) plus its own `window` and `static` record — a root-scope
  `tools/result` listener does receive child-agent dispatches;
- the two loads happened ~8 s apart and did not interfere, because recorder
  state is keyed by session id;
- static authoring quality resolved inside the child agent's scope
  (`skills.list({ scope: agent })`), so subagent loads are scored on the same
  four dimensions as root loads.

Model rules that follow from that:

- **One window per load, several per session.** A load in a _later_ loop step
  closes the previous window as `superseded` and records the newcomer in
  `otherSkills` (that is the trigger-collision signal). Two loads inside the
  _same_ loop step are parallel use: both windows stay open, and the follow-up
  tool calls count for each of them, because one batch of work is not one
  winner. The step comes from `agent/pre-step`.
- **Aggregation is per skill, across every session.** A skill loaded by a
  subagent contributes to the same skill entry as a root load. The raw JSONL
  keeps `sessionId`/`step` on every record, so a per-agent breakdown is a report
  projection away, not a recording gap.
- **Correction evidence is weaker in child sessions.** The next user message in
  a child is usually the parent agent's instruction, not human pushback, so the
  correction rate mostly stays at zero there; effectiveness for subagent runs
  leans on tool-error and abandoned-load rates instead.
- An interrupted child can leave its window open until the TTL sweep, which
  shows up as an open window rather than a closed one. It is never attributed to
  unrelated later work.

### MCP thresholds are configuration

The three MCP rules use configurable limits so a deployment can be stricter than
the defaults (`20%` server error rate, `3000 ms` p95, `30%` single-tool error
rate):

```yaml
config:
  mcpErrorRatePercent: 20
  mcpToolErrorRatePercent: 30
  mcpP95Ms: 3000
```

### Validating with real MCP traffic

1. Restart DSH once so the current plugin generation loads (profile plugins are
   imported at boot), then run `node scripts/accept.mjs [baseUrl]`: it checks the
   JSON route shape, the scoring block, the MCP/runs boards, the snapshot files
   and the recorded telemetry, and prints the restart hint when the host is still
   serving an older generation.
2. Run a session that uses an MCP tool, e.g. "use context7 to look up the Rails
   routing API".
3. Open the popup → **MCP** tab: the server should appear with calls, error rate,
   p50/p95, health and any per-tool failures.
4. `cordis_inspect_query { provider: "skill-eval", method: "mcp" }` returns the
   same board for scripting/agents.

A headless run (`dsh --profile <p> "task"`) can produce the same evidence, but it
needs model credentials in that profile (`DEEPSEEK_API_KEY`), which is why the
in-session validation above is done on the desktop host.

## Run scores (every execution gets a grade)

The skill score grades an artifact; a **run score** grades one execution (one
session) so "how did this run go?" has an answer too. It is built from what the
session actually did, not from a re-run:

| dimension  | weight | formula                                                                  |
| ---------- | ------ | ------------------------------------------------------------------------ |
| quality    | 0.40   | mean score of the skills this run loaded                                 |
| stability  | 0.30   | `100 − 60·toolErrorRate − 40·loopErrorRate`                              |
| outcome    | 0.20   | `100 − 45·correctionRate`                                                |
| efficiency | 0.10   | `100 − max(0, callsPerLoad − 8)·6`, capped at 45 when `callsPerLoad < 1` |

Weights differ from the skill score on purpose: a run is a sample of work, so
outcome and stability carry more than authoring quality. Each run score carries
`confidence` and `provisional` (fewer loads than `minSamples`), and the
`efficiency` cap stops "loaded a skill and did nothing" from looking perfect.
Run scores appear in the **Runs** board (popup), the markdown/HTML reports, the
`runs` inspect method and `/skill-eval runs`.

## Developer mode: Cordis Inspect provider

`cordis_inspect_list` / `cordis_inspect_query` are the harness's read-only
developer capabilities. The plugin registers its own Host provider (default on,
`inspectProvider: false` to disable), so eval data is queryable next to the
harness's own `Service`/`Event`/`Config` providers:

```jsonc
// cordis_inspect_query { platform: "host", provider: "skill-eval", method: "summary" }
{ "totals": {...}, "scoring": {...},
  "skills": [{ "skill": "pdf-tools", "score": 88, "grade": "B", "confidence": "medium",
               "dimensions": {...}, "advice": [{ "id": "user-corrections", "severity": "critical" }] }] }
```

| method     | returns                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `summary`  | every skill: score, grade, confidence, four dimensions, advice identities (no prose — bounded) |
| `skill`    | one skill in full, including advice text; errors when nothing is recorded                      |
| `mcp`      | per-server calls, errors, error rate, p50/p95 latency, health, per-tool breakdown, MCP fixes   |
| `edits`    | screened skill edits from the review ledger (hypothesis, dimension, verdict, diff hash)        |
| `runs`     | recent per-session runs                                                                        |
| `standard` | active weights, grade floors, minimum samples                                                  |

The registration is a real `cordisInspect.register({ manifest, query })` call:
the manifest carries `id`, `description` and methods with descriptions and JSON
schemas, and the query handler is read-only (it reuses the same analyzer as the
tool, the popup and the HTTP route, so every surface agrees by construction).

Text surfaces got the same views without leaving the conversation:
`skill_eval_report { view: "mcp" | "runs" | "standard" }` and
`/skill-eval mcp|runs|standard`.

## Changing the grading standard

The standard is configuration, not code — a user can re-weight the four
dimensions and move the grade bands without touching the plugin:

```yaml
config:
  weights: { static: 30, reliability: 25, effectiveness: 30, efficiency: 15 }
  thresholds: { excellent: 90, good: 80, pass: 70 }
  minSamples: 3
```

Rules the analyzer enforces so a hand-typed number cannot corrupt a score:

- weights are clamped to positive numbers and **normalised to 100%**; the
  report shows the normalised values under `scoring.weightsPercent`;
- a weight of `0` drops that dimension entirely (weight redistribution already
  handled it) — e.g. `static: 0` grades pure runtime behaviour;
- all-zero weights fall back to the defaults instead of dividing by zero;
- thresholds are re-ordered (`excellent ≥ good ≥ pass`), D stays 60, and any
  value outside `1..100` falls back to the default.

Optional external basis: `normalizeWeights(input)` accepts either fractions
(`0.3`) or percentages (`30`), so a workflow can compute weights elsewhere.

## Is the score valid?

The score is a _diagnostic index_, not a benchmark. Each dimension is anchored to
one observable signal, and the suite pins the direction of every dependency:

| dimension         | anchored to                                                                                                   | deliberately not                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| static 30%        | the skill definition itself (description, trigger language, sections, size, examples, progressive disclosure) | whether the content is _correct_                                    |
| reliability 25%   | load success × post-load tool error rate × loop-error rate                                                    | error severity (a refused write and a flaky network count the same) |
| effectiveness 30% | user corrections, ignored loads, sibling collisions                                                           | task outcome (there is no ground truth per run)                     |
| efficiency 15%    | tool calls per run, load latency, billable tokens per load                                                    | exact provider billing reconciliation                               |

Every skill score also carries a **95% bootstrap interval** over its recorded
loads (`score.ci = {low, high, resamples}`): load-level samples are resampled
with replacement 200 times, each draw is re-aggregated and re-scored, and the
2.5/97.5 percentiles become the interval. That is why the report can say
"88.0 (79-94)" instead of pretending a 5-load point estimate is exact. The
resample count is configurable (`ciResamples`, 0 disables it), the RNG is seeded
per skill so the same data always yields the same interval, and fewer than two
loads yields no interval at all.

Intervals also drive a **ranking caveat**: when two adjacent skills' intervals
overlap and their totals are within 10 points, the report says so
(`ranking.note`) instead of letting a "worst skill" list imply an order the data
cannot support. Run scores get the same treatment: each run bootstraps its own
windows, so `62.5 (41.2–88.3)` shows how little a two-window run can prove.

Beyond the sensitivity tests, a property suite generates random windows with a
seeded RNG and asserts invariants over the real scoring pipeline: scores stay in
0-100, the interval always contains the point estimate, one more tool error never
raises reliability, one more correction never raises effectiveness, custom
weights always normalise, the ranking caveat appears exactly when intervals
overlap closely, MCP advice appears exactly past its threshold, and the same
evidence always yields the same score and advice (reproducibility).

`node --test` contains sensitivity tests that inject exactly one bad signal at a
time and assert that _only_ the matching dimension moves:

- four tool errors out of eight calls → reliability drops, static unchanged
- three correcting messages → effectiveness drops, reliability unchanged
- twenty calls and a 9 s load → efficiency drops, effectiveness roughly stable
- three failed loads with a perfect body → reliability is 0 and the total falls
  below 60, so good writing cannot rescue an unusable skill

Known validity limits, stated as limits rather than fixed:

1. **Short sessions are now judged separately.** A subagent session that loads a
   skill and immediately returns used to count as "ignored after load" — literally
   true, but a 2-step child is not the same failure mode as a root session
   dropping a skill. Windows now record `origin` (`subagent` or null) and the
   abandonment rate is computed over root runs only; the denominator is exposed
   as `abandonBase` so the report shows how much evidence it used.
2. **Corrections are language-shaped.** The detector covers common Chinese and
   English pushback; sarcasm, silent dissatisfaction, or a correction phrased as
   a new request are missed.
3. **No outcome ground truth.** Effectiveness is a proxy built from what the user
   did next, not from a verified task verdict.
4. **Provisional scores.** Below `minSamples` loads the number is marked
   provisional on purpose; treat grades on 1–2 loads as anecdote.

## Known blind spots

- Two load paths are recorded: the `skill` tool call (`via` absent, timed) and a
  user-typed `/skill-name`, which the harness resolves without a tool call and
  injects as a user message carrying `source.kind === 'skill-invocation'`
  (`via: 'invocation'`, no `loadMs`). The message repeats on later steps, so it
  is deduped by message id. Still invisible: content injected by another plugin
  (`agent.inject()`), instructions baked into a preset's own prompt (not a skill
  load at all), and any other profile or host, whose telemetry lives in its own
  data directory.
- "Effectiveness" is inferred from the follow-up message, not from a task
  outcome. A correct result followed by an unrelated complaint counts as a
  correction; the TTL keeps that window narrow but cannot make it exact.
- Static checks read the _resolved_ catalog entry for the global layer. Skills
  that only exist inside an agent-preset layer may resolve to `null` static
  evidence (the runtime dimensions still work).
- The store grows without pruning. One record pair per skill load; a very busy
  profile should eventually get a compaction pass.
- The dashboard route is served by `webServer` and cannot be reclaimed during a
  hot reload in the same host process: after a disable/enable cycle the earlier
  instance keeps answering `dashboardPath` (old handler, old state), and the new
  registration is refused as a duplicate. Registration is therefore best-effort
  and logged instead of thrown, and `dashboardPath` is a config knob so a
  source edit can be previewed on a fresh path. A host restart re-registers the
  canonical path cleanly.

## Configuration keys

All 25 settings, in the order the native form renders them. The form persists to
`settings.json`; `dataDir`/`DSH_SKILL_EVAL_DIR` still wins for the data root.

```yaml
enabled: true
windowToolCalls: 12 # tool calls that count as evidence for one load
minSamples: 3 # loads before a score stops being provisional
maxAdvice: 3 # advice items per skill in the summary
weights: { static: 30, reliability: 25, effectiveness: 30, efficiency: 15 } # normalised to 100%
thresholds: { excellent: 90, good: 80, pass: 70 } # A/B/C floors
windowTtlMs: 1800000 # a run older than this is not blamed on a later message
dataDir: ~/.dsh/skill-eval # optional override
turnReports: true # one board per settled turn under reports/turns/
turnReportsKeep: 50 # how many per-turn boards to retain
reportOnTurnEnd: true # write reports/latest.md + latest.json after each turn (no tokens)
tokenBudgetPerLoad: 20000 # billable tokens per load before efficiency/advice react
cacheReadWeight: 0 # weight of cached input tokens (near-free by default)
countTokens: true # attribute real provider usage to skill windows
adviceNoiseFloor: true # advice must clear its 95% interval to stay critical
registerReviewTool: true # skill_eval_review: leakage critic + audit ledger
editBudgetMax: 4 # concurrent edits a first-round skill may carry
editBudgetMin: 1 # annealed minimum
editBudgetHorizon: 6 # accepted edits over which the budget anneals
noveltyWindow: 2 # same-dimension edits that trigger exploration
pruneMinLoads: 6 # loads before a prune recommendation is allowed
pruneMaxScore: 60 # low score + low interval -> prune candidate
promptHint: true # the one-line system-prompt hint (~60 tokens/turn); false = zero fixed cost
inspectProvider: true # register the eval data as a Cordis Inspect provider
registerTool: true
registerCommand: true
webDashboard: true # HTML page + the JSON route the client reads (versioned alias included)
dashboardPath: /skill-eval # change it if a reload could not reclaim the old route
```
