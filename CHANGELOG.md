# Changelog

## 1.20.3 — review hardening

A full independent review (host, client, tests/packaging, plus a second-model
pass) reproduced the issues below. Every fix has a regression test.

- **The per-turn strip counts real errors.** It read `data.isError`, but DSH's
  tool-call payload is `ToolChatData { root }`; errors now come from
  `root.isError`, and the strip retries the report when the 10 s cache predates
  the turn (rapid consecutive turns used to render nothing).
- **Settings writes cannot lose a field.** Both HTTP paths now merge inside the
  serialized write queue (`updateSettings`); two overlapping partial saves keep
  both keys. `windowTtlMs`, `reportOnTurnEnd`, `turnReports` and `promptHint`
  are read live, so "saved values apply immediately" is true.
- **A failed `skill` load opens no evidence window** and no longer supersedes the
  previous skill's window; the test now asserts after turn-stop/dispose.
- **Corrupt window records cannot crash reporting.** Nested `mcp` buckets and
  tool entries are normalised on read (plus defence-in-depth guards in the
  score/report merge), and finite-but-invalid timestamps render as `—`.
- **The release checks can fail.** `canonical-route` fails on restart skew,
  `turn-boards` fails with zero boards, manual rows are INFO and excluded from
  the PASS count, and `weightsPercent` uses largest-remainder so it always sums
  to 100 (2/2/2/1 used to show 101 and fail verify-live).
- **The accept CLI is honest.** It reads `dataDir` from the served report
  (previous `JSON.parse` of an object was silently swallowed), and flag values
  no longer become the base URL.
- **The packaging doctor passes in an installed tarball** (no `client/` sources
  to compare), requires locale/scripts/README/CHANGELOG/LICENSE in `files`, and
  `--release` opens the tarball instead of only checking that it exists.
- **Client degradation works.** Versioned data/settings routes that answer
  200 HTML (DSH's prefix route) now fall back to the canonical JSON routes
  instead of showing a parse error; the stale banner is reachable again.
- **Per-turn boards carry the settled turn** (session+turn passed from
  `agent/turn-stopping`), coalesced writes emit one board per turn, snapshots
  are written atomically, and history/impact use the shared timestamp guard.
- **Security/hygiene:** the settings fence also rejects rebinding Hosts (not
  only a mismatched Origin), 403/413 paths and DNS rebinding have tests,
  analyzer/listener disposers are released on teardown, the scheduler guards
  against writes after dispose, duplicate `/skill-name` invocations collapse on
  the durable read path, the dev tab renders the settings file/warning count,
  the settings form keeps in-flight edits and labels its controls, and the
  score colours follow the configured grade floors.
- Tests: **258 passing** (`npm test`, jsdom installed).

## 1.20.2 — MCP board and settings readability

- **MCP tab rebuilt.** The old tab was one SVG chart with two thin bars plus a
  bare grid: the value label collided with the threshold line, the last table
  column was clipped ("2606/260…"), and the table had no container. It is now a
  latency card with CSS meters (p50 solid, p95 tinted, dashed threshold marker
  on the track), a carded server table with a grade chip, and carded advice /
  failing-tool sections. Latencies render as `2.6s` / `180ms` so nothing is
  truncated. With no recorded calls the tab is a single empty card instead of a
  chart card plus an empty table that read as two broken panels.
- **Settings readability.** Weight fields show a `%` unit, grade-floor help no
  longer repeats the label ("A 级下限 / A 级下限。"), units are localized in the
  Chinese form and web page (`loads → 次加载`, `edits → 次修改`), the config
  dialog is titled 「配置」 with the field summary as its subtitle, and the web
  page keeps readable headings in dark mode.
- **CSS collision fixed.** The advice container reused `.sev-sub`, which also
  styles the panel subtitle, so the later rule silently restyled the header.
  Advice blocks now use `.sev-advice-list` / `.sev-card`.

## 1.20.1 — board honesty pass

- **The 「配置」 button no longer relies on `window.open`.** The desktop shell
  denies every popup (`setWindowOpenHandler` returns `deny`; only `https:` URLs
  are handed to the browser), so on an `http://127.0.0.1` board the button did
  nothing at all. It now opens the same settings form in an in-panel dialog,
  with Escape/backdrop close and the web-config link hidden where the shell
  would deny it. The web page and the native bundle seat still exist.
- **The dev tab reports real diagnostics.** The data route now carries a `dev`
  block (loaded module vs package on disk with the restart-skew flag, claimed
  route/tool counts, settings file, warning count) and the tab renders it next
  to the effective scoring standard; the data endpoint shown is the versioned
  URL the client actually calls, not the bare prefix.
- **The MCP latency chart follows the configured threshold.** `mcpP95Ms` now
  ships with the report, so the alert line can no longer disagree with the MCP
  advice that uses the same number (3000 ms remains the older-payload fallback).

## 1.20.0 — per-step trajectory

- **Per-step loop telemetry:** the recorder persists one row per agent step
  (turn, step, tool calls/errors, MCP calls, loop errors, tokens, duration,
  loaded skills). `lib/steps.js` scores each step 0–100 and groups turns.
- **New board tab 「轨迹 / Steps」:** step KPIs, recent-turn comparison with
  deltas, per-turn step list with score chips, and a skill filter. Each skill
  card gets a「查看轨迹」button that opens the tab filtered to that skill.
- Step records are additive event-log rows; old telemetry stays readable.
- **Multi-skill turn strip:** each skill loaded in a turn keeps its own chip
  and now its own "next fix" (up to three); previously only the first global
  suggestion was shown. Covered by a two-skill regression test.
- **npm bin targets normalized** (`scripts/*.mjs` without `./`): npm 11 was
  stripping all three bins at publish time with an "invalid and removed"
  warning, so a published install would have lost the CLI helpers.
- **One-command build:** `npm run build` (format/lint/client/doctor/tests),
  `npm run build:pack` (adds tarball + release doctor), `npm run build:install`
  (also installs into the desktop profile), `npm run build:fast` (client +
  doctor only). Implemented in `scripts/build.mjs`.
- Tests: **239 passing** (new step scoring/recorder/report/client-filter suites).

## 1.19.1 — test hygiene

- Client tests share one `createHost(window, style)` helper and top-level
  `createRoot`/`act` imports instead of 18 copies of the same setup.
- No runtime change; 232 tests still passing.

## 1.19.0 — board charts + client parts + tooling

- **Client split with a zero-dependency builder.** `client.js` is now generated
  from `client/*.js` by `scripts/build-client.mjs`; `prepack`/`pretest` rebuild
  it, doctor fails when the shipped file is stale, and `client/README.md`
  documents the workflow. The package still ships one self-contained loader
  factory, so installation needs no build.
- **Terminal scripts share plumbing.** `scripts/lib.mjs` now owns bridge/base
  discovery, dashboard base, expected version and timeout HTTP GET; accept and
  verify use it (tests cover precedence and error messages).
- **Formatting/linting.** Prettier (config + `format`/`format:check`) and ESLint
  10 flat config (`lint`) added as dev dependencies; all source files formatted.
- **Board charts (pure SVG, no dependency):** score distribution histogram with
  average marker, per-skill trend sparkline, evidence-coverage donut, MCP
  p50/p95 latency chart with the 3000 ms threshold, and session-activity bars.
  Charts also appear on the Runs and MCP tabs; every chart carries an
  `aria-label` with its data.
- **Tests:** 232 passing; lint/format/doctor/package gates re-run in 1.19.0.

## 1.18.5 — hygiene follow-up

- **Locale metadata restored.** DSH reads `locale/<lang>.json` for the plugin's
  localized market title/description; 1.18.4 wrongly deleted it. The files are
  back, trimmed to `meta.title` + `meta.description` only (the old 16 unused UI
  keys were the actual drift), and the doctor now checks both locale metas.
- **Settings group metadata now comes from the host.** Every field ships
  `group`/`groupZh`; the client groups by it and keeps its local classifier only
  as an older-payload fallback, removing a second copy of the grouping rules.
- Tests: **228 passing**.

## 1.18.4 — code hygiene

Full review: [docs/CODE-REVIEW.md](docs/CODE-REVIEW.md).

- Removed dead `locale/*.json` (unused at runtime, already drifted from the
  client dictionary), with exports/files/doctor/docs updated.
- Consolidated duplicated helpers: `lib/random.js` (FNV hash + mulberry32) and
  `lib/html.js` (HTML escape) used by score/report/index/render/settings.
- Deleted dead TEXTS keys and CSS left by the removed More-menu/detail surfaces;
  documented the real client seats in the file header; added the missing
  `.sev-btn--ghost` rule.
- Restored serialized atomic settings writes (a regression from an earlier
  refactor) and added a regression test; added a settings-group drift test.
- Added `.editorconfig` and `.gitignore`.
- Tests: **227 passing**.

## 1.18.3 — settings aligned with the general settings layout

- Per-setting help lines (zh/en), units (loads / ms / tokens / edits), and
  switch-style booleans for the 25 settings; section rows now use the same
  label + description + control pattern as DSH's 通用设置.
- The web config page renders the same help text and units.
- 225 tests.

## 1.18.2 — panel and settings polish

Reference: the context-insight panel (`dsh-context`) and the generic settings
layout.

- **Board panel**: KPI row (skills / loads / actionable / average score), a
  search box, an "needs a fix" filter chip, a “Configure” shortcut next to
  Refresh/Copy, and a last-updated stamp.
- **Native settings form**: a bilingual heading + subtitle, and the missing
  `windowTtlMs` field (25 settings); labels/group titles follow the app locale.
- English TEXTS parity restored for every new string; 225 tests.

## 1.18.1 — four-layer audit fixes

Full report: [docs/AUDIT.md](docs/AUDIT.md). Findings reproduced and fixed
across host data, scoring, HTTP, client and packaging.

- **Data integrity:** `__proto__` telemetry keys can no longer pollute
  `Object.prototype` or crash reports; a torn final JSONL line is repaired
  before the next append; cumulative window snapshots no longer double-count
  run counters.
- **Correctness:** the bootstrap CI uses the same scoring options as the point
  estimate; recorded static profiles are normalised; evicted windows are
  censored from abandoned-run scoring; grade floors are sorted, not clamped.
- **Privacy/size:** skill bodies are no longer persisted or shipped in reports.
- **Performance:** report cache keyed by store identity + 2 s TTL; stable locale
  subscriptions; memoized cards.
- **HTTP:** same-origin write gate + `x-skill-eval-config` header, atomic
  serialized settings writes, merged-weight validation, byte-accurate 413,
  versioned board/config pages render their own base.
- **Client:** request generation guard, focus trap/restore, clipboard cleanup,
  settings-page styles, duplicate i18n key fixed, aria roles/live status,
  English TEXTS parity.
- Settings: `windowTtlMs` (25 fields), bounds aligned with the Config schema.
- Tests: **225 passing**.

## 1.17.5 — last mixed-language strings

- Ranking note and validity statements are bilingual (`noteZh`, `canSayZh`,
  `cannotSayZh`); HTML board and client panel pick the Chinese copy.
- 212 tests at the time.

## 1.17.4 — advice localization and README tightening

- Every advice rule carries `titleZh`/`fixZh` (MCP names filled in); localize
  the whole report once for the HTML board; client cards/MCP list/turn strip
  select the Chinese copy. README opens with a Chinese TL;DR; config key list
  moved to `docs/DETAIL.md`; full config documented.

## 1.17.3 — release candidate

- Copy button falls back to `execCommand('copy')` with failure feedback.
- Packaging: LICENSE, explicit `files`, three bins, release scripts and doctor
  release gate; clean-profile smoke documented in `docs/RELEASE.md`.

## 1.17.0

Board and settings moved to the same seats the context plugin (`dsh-context`)
uses, per the request to follow that pattern.

- **Board = sidebar panel + main panel.** Registers `sidebar.panellist`
  (id `skill-eval`, order 40, gauge icon, localized label) and `main` keyed
  `skill-eval`. Clicking the sidebar icon opens a full central board panel:
  header with skill/actionable counts, tabs (skills / runs / MCP / dev),
  refresh and copy, reusing the existing SkillCard/RunsView/McpView/DevView.
- **Settings = bundle config page.** Registers `plugins.bundle.config` keyed
  `dsh-skill-eval` (the bundle's own page under Plugins), replacing the row
  config seat; the native settings form is unchanged.
- Removed: the session-header More-menu board row and the row-config seat.
  Kept: the in-conversation result strip, the versioned web board, the
  debug-only popup (opt-in).
- Client tests rewritten for the new seat set (208 passing).

## 1.16.1

- **Versioned page aliases.** `/skill-eval/board/<version>` and
  `/skill-eval/board/<version>/config` are registered as exact routes each
  release. Hot-reloaded generations cannot reclaim the canonical page route an
  older generation still owns, which is why the bilingual board initially kept
  serving the old page; the versioned alias is always the current one. The
  client's board/config links and the verify/accept scripts use it (with a
  canonical fallback for a clean start).
- Verified live: `?lang=zh` / `Accept-Language: zh-CN` return Chinese chrome on
  `/skill-eval/board/1.16.1`, the settings page renders Chinese labels, and the
  English default is unchanged.

## 1.16.0

The board and the settings page are bilingual (中 / EN).

- Language resolution: explicit `?lang=zh|en` → `Accept-Language` header →
  English fallback (pure `resolveLang`, unit-tested).
- The board translates its chrome: title, scoring line, totals, dimension names,
  next steps, evidence (can / cannot say), screened edits, MCP and runs tables,
  plus a `中文 / English` switch link.
- The settings page translates group titles, all 24 field labels, banners and
  buttons; the switch keeps you on the page.
- Advice titles/evidence/fixes come from the host rules and stay in English for
  now; the surrounding chrome is translated. Documented in `docs/ENTRYPOINTS.md`.
- 208 tests (new i18n suite + route-level language checks: header wins over
  default, explicit query wins over header).

## 1.15.5

Entry points consolidated to three human surfaces.

- Kept: the in-conversation result strip (`conversation.chat.turnTail`), one
  **Skill eval board** row in the session header's **More** menu
  (`conversation.session.header.views.actions`), and the plugin's own row config
  page (`plugins.row.config`) for scoring settings.
- Removed as duplicates: the plugin detail-page section
  (`plugins.detail.section`) and the always-on sidebar button; the sidebar
  button and the popup now come back together only with
  `window.__SEV_ENABLE_POPUP__ = true` (debug surface).
- `docs/ENTRYPOINTS.md` (bilingual) is the single reference for where things are;
  the READMEs point at it instead of repeating the tables.

## 1.15.4

Hot reload now actually works on this machine — documented and verified.

- The desktop profile patch gained an `hmr` entry with
  `root: ["/Users/adams/Documents/dsh-plugins/dsh-skill-eval"]`, so Cordis HMR
  watches the plugin source directory. A source edit (or `touch`) replaces the
  running plugin generation **without a restart**; the versioned route changes
  from `text/html` to `application/json` immediately.
- Verified end to end on the live host: 1.15.2 → 1.15.3 → 1.15.4 all rolled
  over through HMR, `dsh-skill-eval-verify` reached 10/10 PASS (including the
  first per-turn board), native client seats became active
  (`plugins.row.config` key `dsh-skill-eval#skill-eval`,
  `conversation.session.header.views.actions` id `skill-eval-board`,
  `sidebar.footer.action`, `plugins.detail.section`, `conversation.chat.turnTail`),
  and a live settings save (35/25/25/15) moved the report's `weightsPercent`
  immediately.
- Two caveats recorded in docs: the **canonical** `/skill-eval/data` and
  `/skill-eval/settings` routes can still be served by an older leaked instance
  after a reload — use the versioned routes (what the client and verify do); and
  a page refresh is only needed if the client HMR receiver did not swap the
  bundle.
- `docs/DEV-RELOAD.md` rewritten around this recipe.

## 1.15.3

Hot reload works when the plugin is installed as a **tarball** into the profile,
not as a `link:` dependency.

- Root cause of "I edited the code and the live host kept running the old
  module": with a linked package the loaded files live outside the profile
  directory, and Cordis HMR only replaces plugins whose loaded files below the
  profile changed. Installing `npm pack` output (`file:…/dist/<name>-<v>.tgz`)
  puts a real copy under `profile/node_modules`, so a Plugin Manager
  recomposition swaps it in place — verified by bumping the version and watching
  `/skill-eval/data/<new version>` turn from `text/html` into JSON with no
  restart.
- `dist/` holds the installable tarball; `docs/DEV-RELOAD.md` documents the
  pack → `dsh plugin add` → recompose loop, and the link-install caveat.

## 1.15.2

Packaging doctor: `dsh-skill-eval-doctor` (or `npm run doctor`).

- Twelve pre-flight checks for the failures that only show up as "the plugin
  silently does not appear after a restart": manifest name/version/exports,
  `dsh.engines`, bundle patch presence, client platform, the patch row id, the
  native settings key the row implies (`<package>#<row>` must literally appear in
  the client), every relative import resolving across host/client/lib, locale
  dictionary parity, and the client's `DATA_VERSION` matching package.json.
- Runs in milliseconds and exits non-zero on any drift, so it can guard a release
  or precede a restart.

## 1.15.1

One-command post-restart verification: `dsh-skill-eval-verify` (or
`npm run verify`).

- Checks, in order: the versioned data route returns JSON with all report keys;
  the settings API returns 24 fields and effective values; the board HTML carries
  the next-steps / evidence / ledger sections; the settings page renders its
  fields; the latest snapshot has skills and runs; per-turn boards appear once a
  turn has settled; canonical and versioned routes agree and weights sum to 100;
  plus two manual rows for the native seats the CLI cannot inspect.
- The "no restart yet" case is reported the way it actually looks: versioned
  route answers `text/html`, so `versioned-json` fails and the summary says to
  restart — no false green.
- Verified against a disposable profile running the same package: 10/10 PASS,
  including `report-contract` (canonical=versioned) and the settings API.

## 1.15.0

One board per execution.

- **Per-turn boards.** Every settled turn that loaded a skill now writes its own
  pair under `reports/turns/<session>-t<turn>.{md,json}` (in addition to
  `latest.*`), with retention `turnReportsKeep` (default 50) and a switch
  `turnReports` (default on). This is the literal "每次执行后结果在单独的看板":
  each run keeps its own snapshot instead of overwriting the previous one.
- **`skill_eval_report {view:"turns"}` / `/skill-eval turns`** lists those
  boards newest first (time, session, turn, skills, size, file) in markdown or
  JSON, so an agent can open the exact board for one run.
- Both surfaces cost zero model tokens; the writer is still debounced and
  failure-tolerant (a broken turn board never blocks the latest snapshot).

## 1.14.0

MCP debugging got per-tool latency, not just per-server.

- **Per-tool samples.** Every `mcp__<server>__<tool>` call now records duration into
  the window (bounded at 20 samples per tool, merged across windows), so a tool
  that is fine on average but terrible at the tail shows up.
- **Report rows** carry `avgMs / p50Ms / p95Ms` per tool next to calls/errors.
- **`mcp-tool-slow` warning** (`mcpToolP95Ms`, default 5000, needs ≥2 calls):
  `MCP tool "context7/query-docs" has a slow tail — p50 4000ms · p95 9000ms`.
- **`/skill-eval mcp` markdown** gained a _Slowest tools (p95)_ section and shows
  p95 next to error counts for failing tools.
- Aggregation was carrying tools only as calls/errors; it now carries samples and
  ms through `aggregate`, so the numbers survive every merge step.

## 1.13.0

Developer diagnostics — the "is this thing actually working" view.

- **`skill_eval_report {view:"dev"}` / `/skill-eval dev`** reports the module
  generation loaded versus the version on disk (the ESM-cache restart trap:
  `module 1.10.1 vs disk 1.13.0 — restart DeepSeek Harness`), the data directory
  and settings override file, store health (records, type counts, last-event
  age, failed writes, queue), the routes this generation actually registered,
  registered tools, inspect-provider state, recent host warnings, and findings
  with severities.
- Route/tool/inspect registration and warnings are now recorded in a diagnostics
  registry at apply time, so the view reflects what really mounted instead of
  what the code intended.
- This is the "developer mode" half of the objective: one command answers why an
  edit is not visible and which generation is live.

## 1.12.2

- **Graceful degradation on an older host.** The native settings page detects a
  non-JSON answer from `/settings` (the stale prefix route of a previous
  generation) and explains that a restart is needed, with a link to the web
  settings page instead of showing an empty form.
- **Real-payload compatibility fixture.** `test/fixtures/live-1.10.1.json` is an
  actual payload captured from the running 1.10.x host (turnLoads present,
  `edits`/`validity` absent); the new client is tested against it so a newer UI
  never breaks on an old host.
- **docs/DEV-RELOAD.md** — why edits do not appear until a restart (ESM module
  cache + boot client scan), how to probe the live generation, the debug
  switches, and the disposable-profile verification recipe that produced the
  17-check PASS evidence.

## 1.12.1

- Settings weight fields use the same 0-100 scale the profile config uses
  (step 5) instead of 0-1, so the native page can save 30/35/... directly.
  Both scales still normalise at scoring time.
- Acceptance CLI now passes the settings-API and config-page probes to the
  runner and resolves them under the dashboard base path (configurable with
  `DSH_SKILL_EVAL_BASE`), so `dsh-skill-eval-accept` covers 17 checks.
- Verified end-to-end on a disposable profile: 1.12.0 host routes
  (`/data`, `/settings`, `/config`) all answer, settings POST saves +
  normalises (35/25/25/15 → 0.35/0.25/0.25/0.15), invalid values return 400,
  and acceptance is fully green there.

## 1.12.0

Settings moved into DSH's own settings, and the board into the More menu.

- **Native plugin settings page.** The bundle patch already declares row
  `skill-eval`, so the plugin now registers `plugins.row.config` keyed
  `dsh-skill-eval#skill-eval`: Settings → Plugins → this plugin's row gains the
  standard configure control, and the page renders the same tunables natively
  (grouped weights/thresholds, cost, advice lifecycle, MCP, output) with a
  Save that applies immediately and persists to `settings.json`.
- **Settings JSON API** (`<base>/settings` plus a versioned alias): GET returns
  field definitions + effective values; POST accepts JSON or form bodies, then
  validates, saves and applies. Backs the native page; the HTML page keeps
  working.
- **Board in the More menu.** Registers
  `conversation.session.header.views.actions`, so the session header View row's
  **More** menu gains a `技能评测看板` row that opens the board and dismisses the
  menu.
- Acceptance gained a `settings-api` check (16 in-process checks).

## 1.11.0

Native DSH entry points instead of only a URL.

- **Sidebar entry (always on).** A small gauge button beside Settings now opens
  the reporting board in a new tab (with `window.__SEV_ENABLE_POPUP__ = true` it
  still opens the modal instead). Previously this required the popup opt-in.
- **Plugin detail page section.** Under Settings → Plugins → `dsh-skill-eval`
  the detail page now carries a section: how many skills have telemetry, how
  many have an actionable fix, and buttons for _Open board_ / _Scoring
  settings_. It renders null for every other plugin's subject.
- Registered seats now: `conversation.chat.turnTail` (turn strip),
  `sidebar.footer.action`, `plugins.detail.section`, and `shell.overlay` when the
  popup is enabled.

## 1.10.1

- Hot-reload fix: the dashboard page and the settings page are registered as
  **exact** routes (exact wins over any prefix), so a previous generation still
  owning the `/skill-eval` prefix can no longer shadow them. The prefix route
  stays as a best-effort fallback for other subpaths.

## 1.10.0

The reporting board became a real board, and it got a settings page.

- **Dashboard** (`<dashboardPath>`, e.g. `/skill-eval`) now leads with the
  reporting material instead of only skill cards: **Next steps** ranked by
  expected gain / effort (same ranking as `loop all`), **What the evidence
  supports** (validity: coverage, ranking significance, can/cannot-say lists),
  **Screened edits** (the ledger), then skill cards, MCP, MCP fixes and runs.
- **Configuration page** (`<dashboardPath>/config`): every tunable in one form
  (weights, grade thresholds, samples, advice, token budget, cache weight,
  prune, edit budget, exploration window, MCP thresholds, output toggles).
  Saving validates bounds, writes `settings.json` into the data directory,
  applies immediately in memory and wins over the profile config on reload.
  Invalid submissions return the page with per-field errors and change nothing.
- `/skill-eval config` prints the effective values and the override file path.
- Acceptance gained a `config-page` check (now 15 in-process checks).
- Dashboard header links to the settings page; settings page links back.

## 1.9.0

Two time-aware answers, plus a written scenario matrix.

- **`view:"history"` / `/skill-eval history <skill>`** — chronological load
  table (ok, calls, errors, corrections, latency, turn) and a half-over-half
  trend (`improving` / `degrading` / `flat` / `not-enough-data`) with the
  problem-rate change spelled out.
- **`view:"impact"` / `/skill-eval impact <skill>`** — pairs every screened edit
  with the loads recorded before and after it and judges the error-rate delta:
  only ≥2 closed loads per side and >15pp counts as improved/degraded, anything
  else is `inconclusive` with the reason. This is the "did my edit help?" loop
  closing, and it starts working automatically as samples accumulate.
- **docs/SCENARIOS.md** — 25+ scenarios (single skill, cross-skill, edit
  governance, MCP, runs, config) each mapped to its entry point, expected answer,
  status, plus the six things the tool deliberately does not do.

## 1.8.0

- **Validity dashboard.** `skill_eval_report {view:"validity"}` (and
  `/skill-eval validity`) reports only what the stored evidence supports:
  coverage (skills, intervals, provisional, actionable), ranking significance,
  advice severity counts, ledger composition and — the point — an explicit
  **Cannot say yet** list (no interval at n < minSamples, before/after effect of
  an edit, token cost of a skill the model never loaded). The same payload is in
  the report JSON as `validity`.
- **Edit history in the turn strip.** Expanding a turn now shows the last three
  ledger entries for that skill (verdict icon, dimension, hypothesis) next to
  the fixes, so the conversation carries the evolution, not just the score.
- **Prompt hint** now teaches the safe order: report → `skill_eval_review` →
  edit → re-measure, and points at `view:"loop"` / `view:"validity"`.
- `docs/WORKFLOW.md` gained the validity entry point.

## 1.7.0

- **Batch plans are ranked by expected gain per unit of effort** instead of raw
  score: `impactOf()` weighs headroom (100 − score), severity (critical vs
  warning), evidence strength (provisional samples count less) and the usual
  cost of the fix dimension (static edit ≈ 1x, behaviour change ≈ 2.5x). The
  batch view prints `priority N` with the reasons, so "fix this first" is
  defensible rather than alphabetical.
- **docs/WORKFLOW.md**: the one-page operating manual — flow diagram, the three
  roles (human / agent / plugin), when to use which entry point, the six
  self-deception guards, common states and the honest-limits list. Linked from
  both READMEs.

## 1.6.0

- **Batch loop.** `skill_eval_report {view:"loop", all:true}` and
  `/skill-eval loop all` return one compact plan per skill that currently has an
  actionable fix, worst score first.
- **Next step in the conversation strip.** The turn card now shows
  `下一步 · 可改 <skill> · <dimension> · <fix>` when the turn's skill has a
  critical/warning fix, so the strip points forward instead of only reporting
  history. Locale strings added for both languages.

## 1.5.0

- **Guided optimization loop.** `/skill-eval loop [skill]` (and
  `skill_eval_report {view:"loop"}`) turns the current report into the next
  concrete step, RRSI style: pick the worst skill with actionable advice, cap it
  at that skill's annealed `adviceBudget`, emit the chosen fixes, require a
  `skill_eval_review` screening (leakage critic) before applying, honour the
  exploration directive, then ask for a re-measurement round and warn that
  point-estimate moves are not enough — the interval has to move.
- A quiet skill or an empty dataset explains itself instead of failing.
- Pairs with the ledger: accepted edits anneal the budget, same-dimension edits
  trigger the exploration directive, so repeated `/skill-eval loop` calls walk
  the RRSI loop.

## 1.4.0

RRSI P2/P3 plus the two static-check gaps recorded in `docs/COMPARISON.md`.

- **Annealed edit budget (P2).** Each skill carries `adviceBudget`: it starts at
  `editBudgetMax` (4), anneals toward `editBudgetMin` (1) over
  `editBudgetHorizon` (6) _accepted_ ledger edits using the RRSI cosine schedule,
  and caps how many fixes the report presents as actionable this round.
- **Exploration directive (P3).** When the last `noveltyWindow` (2) reviewed
  edits for a skill all targeted one dimension, the report emits
  `exploration: {stuck, suggestion, reason}` pointing at the least-used
  untouched dimension; `/skill-eval review` now accepts a `dimension`.
- **Reference integrity.** The static profile gains `reference-integrity`
  (weight 8): every `references/…`, `scripts/…`, `assets/…` path in the body is
  checked against the skill directory at load time (best-effort; the check is
  skipped rather than faked when no filesystem view exists). Missing files raise
  a critical `broken-references` rule.
- **Anti-trigger check.** `anti-trigger` (weight 5) scores whether the skill
  says when _not_ to use it; absent → info-level advice.
- **Skill-name check.** `skill-name` (weight 4) enforces kebab-case ids per the
  agentskills.io contract; a violation is a warning.
- New config: `editBudgetMax`, `editBudgetMin`, `editBudgetHorizon`,
  `noveltyWindow`.

## 1.3.0

RRSI P1 mechanisms (see `docs/RRSI-NOTES.md` §6.1).

- **Leakage critic.** New `skill_eval_review` tool screens a proposed skill edit
  before it is applied: hardcoded answers/expected outputs, named benchmarks,
  task ids, machine-specific paths, date windows and input-shape special-casing
  are classified `reject`/`warn`/`accept`, with a required falsifiable
  hypothesis. `lib/critic.js` is pure and tested.
- **Audit ledger.** Every review appends an edit record (skill, hypothesis,
  verdict, reason codes, diff hash) to the telemetry store. The report exposes
  `edits`, `skill_eval_report` returns it, and the Cordis Inspect provider grew
  an `edits` method — so a fix is traceable to the hypothesis it was meant to
  test.
- **Pruning.** A well-sampled skill (`pruneMinLoads`, default 6) whose score is
  below `pruneMaxScore` (60) and whose 95% interval also sits low raises a
  `prune-candidate` critical rule: delete it or merge its one useful step into a
  skill that gets used.
- New config: `registerReviewTool`, `pruneMinLoads`, `pruneMaxScore`.

## 1.2.0

Two RRSI-derived P0 mechanisms (see `docs/RRSI-NOTES.md` §6.1).

- **Noise floor on advice.** The five rate-based rules (post-load errors, user
  corrections, ignored loads, trigger collisions, loop errors — plus MCP rules
  already thresholded) now bootstrap their window-level rate and only keep
  `critical`/`warning` when the 95% interval's low end clears the threshold.
  Signals that are above the mean but still inside noise are reported as `info`
  with the interval in the evidence ("not outside noise yet"). `adviceNoiseFloor:
false` restores the old behaviour.
- **Measured token cost.** Real provider usage from every committed
  `assistant/message` is attributed to the open skill windows
  (`inputTokens/outputTokens/cacheReadTokens`), aggregated into
  `stats.tokensPerLoad` (cached input weighted by `cacheReadWeight`), and used
  for: the efficiency dimension (over `tokenBudgetPerLoad` costs up to 35 points),
  a new `token-cost` advice rule, the Runs board totals and the in-conversation
  card ("≈N tok/load"). `countTokens: false` disables capture. Per-load cost divides only by windows that carried
  real usage; cached input defaults to weight 0.
- New config: `tokenBudgetPerLoad` (20 000), `cacheReadWeight` (0.1),
  `countTokens` (true), `adviceNoiseFloor` (true).
- Token attribution is tested per window, including cache reads and ignoring
  other sessions.

## 1.1.0

- **Results now land in the conversation.** A completed turn that loaded a skill
  gets a result strip above its action row: skill scores, this turn's call and
  error counts, and an expandable fix list. It reads durable per-turn loads from
  `turnLoads`, costs zero model tokens and needs no popup.
- The popup (sidebar button + modal) is now **opt-in**: set
  `window.__SEV_ENABLE_POPUP__ = true` to bring it back. The JSON/API/html
  surfaces are unchanged and still back the in-conversation card.
- Skill loads record the loop `turn` that produced them; the report exposes
  `turnLoads` grouped per session+turn.
- New Claude-Code-pattern test corpus (`test/corpus/`): document-style,
  MCP-dependent, anti-trigger, overlong-monolith and weak-trigger skills, each
  with an asserted verdict; `docs/COMPARISON.md` records the remaining gaps
  (anti-trigger text, frontmatter integrity, reference link integrity, script
  correctness, optional metadata).
- Repository moved to `~/Documents/dsh-plugins/dsh-skill-eval`; the profile
  dependency and symlink were re-pointed.
- Acceptance tooling no longer hardcodes a GUI port: `scripts/accept.mjs`
  resolves the base URL from the argument, then `DSH_WEB_URL`, then
  `~/.dsh/remote-web-ui-relay-bridge.json` (`upstream`), and reports
  **UNREACHABLE** separately from **stale generation** so a wrong port is not
  mistaken for an old module.
- The manual acceptance row now points at the in-conversation strip instead of
  the opt-in popup.
- Live MCP capture was verified against the installed servers (context7 call
  bucketed with latency, health and per-tool breakdown).

## 1.0.0

First stable release. Everything below was built and verified inside one session
against DeepSeek Harness 0.2.2-rc.3; the acceptance report lives in
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

### Recording

- Records every `skill` tool load with duration, success/failure and session id.
- Records user-typed `/skill-name` loads by reading `source.kind ===
'skill-invocation'` messages on `agent/pre-step`, deduped by message id.
- Observation window per load: tool calls, tool errors, MCP calls, loop errors,
  retried model requests, user corrections, sibling skill loads.
- Windows survive the turn boundary (the correction that proves a skill failed
  usually arrives in the next user message) with a TTL sweep.
- Parallel loads inside one loop step stay open together instead of being scored
  as a collision; a load in a later step is a real switch.
- Root vs subagent origin is recorded so short subagent runs do not count as
  "ignored skill".
- MCP tools are bucketed per `mcp__<server>__<tool>` with latency samples.

### Scoring

- Skill score: static 30% / reliability 25% / effectiveness 30% / efficiency 15%,
  A–F bands, provisional + confidence labels.
- Static authoring checks (9, weight-summing 100): description, trigger
  language, whenToUse, size, sections, progressive disclosure, placeholders,
  examples.
- Runtime dimensions from load success, post-load tool error rate, loop errors,
  user corrections, ignored loads, sibling collisions, cost.
- 95% bootstrap confidence interval per skill (seeded, reproducible) and per run.
- Ranking caveat when two skills' intervals overlap closely.
- Run score with its own dimensions (quality 0.40 / stability 0.30 / outcome
  0.20 / efficiency 0.10), interval, confidence, provisional.
- MCP health per server (`100 − 70·errorRate − slow penalty`) with p50/p95,
  failing tools and MCP-specific fixes.
- Standard is user configuration: `weights`, `thresholds`, `minSamples`,
  `ciResamples`, `mcpErrorRatePercent`, `mcpToolErrorRatePercent`, `mcpP95Ms`.
  Weights normalise, a zero weight drops the dimension, unordered thresholds are
  repaired, all-zero falls back to defaults.

### Surfaces

- `skill_eval_report` tool (`skill`, `view: summary|mcp|runs|standard`, `format`).
- `/skill-eval` command (`<skill>`, `mcp`, `runs`, `standard`, `accept`).
- Sidebar footer action + modal overlay with 4 tabs (Skills / Runs / MCP / Dev),
  5 s auto-refresh, copy-as-markdown, Escape/backdrop close.
- HTML dashboard `GET /skill-eval` and JSON API `GET /skill-eval/data`
  (plus a versioned alias).
- Per-turn snapshot `reports/latest.md` + `latest.json` (no model tokens).
- Cordis Inspect provider `skill-eval` (`summary|skill|mcp|runs|standard`).

### Reliability and diagnostics

- Every listener is failure-contained; the two waterfalls always call `next()`.
- Telemetry never touches the durable session log; it lives in
  `$DSH_HOME/skill-eval/<profile>/events.jsonl`.
- `dispose()` flushes queued writes (a real data-loss bug found by tests).
- `node scripts/accept.mjs` and `/skill-eval accept` detect a stale host
  generation; the popup shows a red banner when its payload predates the boards.
- `DSH_SKILL_EVAL_DEBUG=1` mirrors diagnostics to stderr.

### Tests

118 tests, no build step: unit, integration through a fake host, jsdom rendering
of the real popup components, snapshot/acceptance, and seeded property tests over
the scoring pipeline.
