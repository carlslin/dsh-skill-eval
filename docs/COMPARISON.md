# Comparison with the Claude Code / Agent Skills corpus

Reference: [anthropics/skills](https://github.com/anthropics/skills) README (inspected 2026-11-15) and the
[agentskills.io](https://agentskills.io) spec it points at. That repository groups skills as
Creative & Design, Development & Technical (including MCP server generation), Enterprise &
Communication, and the production document skills (`docx`, `pdf`, `pptx`, `xlsx`), plus a
`spec/` and a `template/`. It states the frontmatter contract as two required fields:
`name` (lowercase, hyphenated) and `description` (what it does **and when to use it**).

## Where our evaluator already lines up

| Claude Code / spec expectation                          | What dsh-skill-eval measures                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `description` says what it does **and when to use it**  | `desc-length` + `desc-trigger` + `when-to-use` static checks             |
| Body is instructions, not an essay                      | `body-present`, `sections`, `body-compact`                               |
| Complex skills delegate to `references/` and `scripts/` | `progressive-disclosure` static check + runtime tool-call cost           |
| Skills should actually help when loaded                 | reliability / effectiveness / efficiency dimensions from live windows    |
| Document skills are heavy but must activate precisely   | trigger collisions (`otherSkills`), ignored loads, post-load tool errors |
| MCP-flavoured skills (e.g. MCP server generation)       | per-server MCP board: calls, error rate, p50/p95, health, failing tools  |

## Gaps we found, and what we did

| Gap vs the CC corpus                                                                                     | Status                                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **Anti-trigger language** ("do not use for …") is part of good trigger design                            | ✅ 1.4.0: `anti-trigger` static check + `no-anti-trigger` info advice                                                     |
| **Frontmatter integrity**: `name` must equal the skill id and be lowercase/hyphenated                    | ✅ 1.4.0: `skill-name` check enforces hard kebab-case ids from the parsed summary (raw frontmatter itself still not read) |
| **Reference/script link integrity**: a skill may promise `references/forms.md` that does not exist       | ✅ 1.4.0: checked at load time (`lib/integrity.js`), missing files raise `broken-references`                              |
| **Script correctness**: document skills ship real scripts (`python -m scripts …`); we never execute them | out of scope — a runtime skill cannot be executed by an evaluator safely                                                  |
| Optional metadata (`license`, allowed-tools style fields)                                                | not evaluated                                                                                                             |
| Asset bundles beyond markdown (templates, fonts)                                                         | only inferred through progressive-disclosure text                                                                         |

The test corpus in `test/corpus/skills.mjs` encodes one skill per pattern so the evaluator's
behaviour on each is asserted, and the open gaps above stay visible instead of being forgotten.
