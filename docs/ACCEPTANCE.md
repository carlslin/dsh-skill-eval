# Acceptance report — dsh-skill-eval 1.20.0

> **Historical snapshot — 1.20.0.** The current **1.24.0** release passes
> **331 tests**, ships a 55-file tarball, and reports empty telemetry,
> snapshots and turn boards as **SKIP** on a fresh profile instead of failing. The numbers
> and file names below record the 1.20.0 acceptance run.

Status snapshot for the objective: _skill debugging, MCP debugging, dedicated
boards, developer-mode integration, per-run boards and scores, a scientific
scoring model, a user-adjustable standard, and a publishable release._

Evidence below was produced in this workspace; commands are listed so each row
can be re-run. Screenshots for the UI rows live under `docs/ui/` and the full
walkthrough is in [UI-REVIEW.md](UI-REVIEW.md).

## Objective → delivery

| Objective item         | Delivered                                                                                                                   | How it is verified                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 完善 skill 调试        | `skill_eval_report` tool, `/skill-eval` command, result strip, board, read-only Inspect provider                            | `node --test` (228 tests) + live `verify`                                                     |
| MCP 调试               | per-server calls/errors/p50/p95/health, per-tool latency and MCP-specific advice                                            | `test/report.test.js`, `test/advice.test.js`; live board MCP tab                              |
| 专门的看板             | sidebar **Skill eval** panel + `main` panel (skills/runs/MCP/dev tabs), versioned HTML board                                | jsdom client tests; real-window screenshots (`board-*.png`)                                   |
| 开发者模式结合         | Cordis Inspect provider `skill-eval` (`summary\|skill\|mcp\|runs\|edits\|standard`), dev tab, `/skill-eval dev`             | `test/inspect.test.js`, `test/dev.test.js`; live dev tab shows version 1.17.5                 |
| 每次执行后结果单独看板 | per-turn `turnLoads` + result strip + `reports/turns/*.{md,json}`                                                           | `test/recorder.test.js`, `test/snapshot.test.js`; live turn boards                            |
| 对每个结果评分         | 0–100 / A–F with four dimensions, confidence, seeded 95% bootstrap CI, significance caveat                                  | `test/score.test.js`, `test/properties.test.js`, `test/validity.test.js`                      |
| 评分有效/科学          | sensitivity + calibration archetypes + interval-contains-point property; noise-floor gating                                 | `test/score.test.js`, `test/properties.test.js`, `test/advice.test.js`                        |
| 用户可改评分标准       | 25 settings in the native bundle-config form; weights normalised, zero weight drops, thresholds repaired; JSON settings API | `test/settings.test.js`, `test/accept.test.js`; live save verified (20000 → 25000 → restored) |
| 中英双语               | board chrome, rules' titles/fixes, ranking note and validity statements localized; README dialect                           | `test/i18n.test.js`; live `?lang=zh` board + screenshot                                       |
| 可发布                 | tarball, LICENSE, explicit `files`, bins, release gate, clean-profile install                                               | `npm publish --dry-run`; `doctor --release`; clean-profile smoke below                        |

## Verification layers

1. **Unit + property suites** — `npm test` (rebuilds the browser bundle) → **239 passing**, incl. per-step scoring/recorder/report and the client trajectory filter.
2. **Live host acceptance** — `dsh-skill-eval-accept` → **17/17 PASS**.
3. **Live product surfaces** — `dsh-skill-eval-verify` → **9/9 PASS**
   (`versioned-json`, `settings-api`, `board-sections`, `config-page`,
   `turn-boards`, `report-contract`, `latest-snapshot`, manual seats, turn strip).
4. **Packaging doctor** — `node scripts/doctor.mjs --release` → **PASS**
   (manifest, patch row, client seats, imports, licenses, `files`, bins,
   client build freshness, artifact).
5. **Clean-profile smoke** — the tarball flow is still pending for 1.20.0:
   the desktop profile currently links the source directory. Run the
   `--from-default-profile web` smoke from RELEASE.md before publishing.
6. **Real GUI (Orca computer-use on the running DSH window)** — 1.20.0 verified
   live: sidebar panel opens the board, the 「轨迹」 tab shows step KPIs,
   recent-turn comparison and per-step scores, and skill cards expose
   「查看轨迹」. The multi-skill turn strip is covered by the client test; a
   real multi-skill turn still needs one visual confirmation.
7. **Publishability** — `npm publish --dry-run` succeeded for 1.20.0:
   **47 files, 164.9 kB**. It also exposed npm 11 stripping the bins because
   their targets had a leading `./`; package.json now uses `scripts/*.mjs`
   directly, so re-run the dry-run and confirm the warning is gone.

## Audit

The 1.20.0 four-layer audit and its fixes are recorded in [AUDIT.md](AUDIT.md).

## Known limits (as of this report)

- Loads are recorded from `skill` tool calls and user-typed `/skill-name` invocations; a skill the harness activates without either is invisible.
- Effectiveness is inferred from the next user message, not a task verdict.
- Advice evidence keeps measured ids/numbers in English even in the Chinese UI.
- The plugin detail page renders the English `README.md` (DSH does not switch
  README by locale); a Chinese TL;DR sits at the top of that file.
- The installed-plugin list has no search (platform behaviour).
- Telemetry is append-only; there is no automatic pruning.

## Reproduce

```bash
node --test test/                     # 239 passing (npm test builds the client first)
node scripts/doctor.mjs --release     # release gate incl. dist artifact
dsh-skill-eval-accept                 # 17 checks against the running host
dsh-skill-eval-verify                 # 7 checks + 2 manual rows against the running host
npm publish --dry-run                 # packaging/publishability preview
```
