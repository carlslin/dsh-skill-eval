# Contributing

Thanks for taking the time to improve `dsh-skill-eval`.

## Setup

Node.js 22.18 or newer for the suite. `npm test` strips types and runs the
TypeScript in `src/`; run it directly with
`node --experimental-strip-types --test "test/**/*.test.ts"` (Node 22/24 treat a
bare `test/` directory as an entry module). The published `.js` / `.mjs` files
still run on Node 20.

```bash
pnpm install            # devDependencies only; runtime has no dependencies besides the DSH peer
npm test                # compile, then the suite against src/
```

`npm test` runs `pretest` first, which emits `index.js`, `lib/*.js`,
`scripts/*.mjs` and rebuilds `client.js`. Logic tests import `src/` either way,
so a stale `lib/*.js` cannot hide a scoring change. The client and packaging
tests still read those emitted files, which is why `npm test` compiles first.

## Changing the UI

- Edit `src/client/*.ts`, then run `npm run build:client`. That command runs
  `tsc` and then writes `client.js` with the `typescript` devDependency.
  `client.js` is generated — never edit it by hand; `npm run doctor` fails when
  it is stale.
- The board is the sidebar panel (`main` slot); the same settings form is mounted
  three ways: the native bundle-config seat, the in-panel dialog, and the
  standalone web page (`src/lib/settings.ts` renders the latter).
- Wire hot reload for a dev checkout before iterating:
  [docs/DEV-RELOAD.md](docs/DEV-RELOAD.md). Without it, disable/enable only
  re-runs `apply` and the old module stays in the ESM cache.

## Changing the server or scoring

- Sources are TypeScript under `src/` (`src/index.ts` host entry, `src/lib/*`
  pure logic, `src/scripts/*` CLIs, `src/client/*` browser snippets). `npm run
compile` emits the runtime paths the package ships (`index.js`, `lib/*.js`,
  `scripts/*.mjs`) — never edit the emitted files.
- New report fields belong in `src/lib/report.ts` and are pinned by
  `test/report.test.ts`; new routes need a versioned alias, because an older
  generation can keep the canonical path (see `docs/DEV-RELOAD.md`).
- `package.json` version and `src/client/03-data.ts` `DATA_VERSION` must match —
  a test enforces it.

## Before a pull request

```bash
npm run build:fast      # compile + client build + doctor (version/locale gates)
npm run lint
npm run typecheck
npx prettier --check .
npm test
```

Keep tests next to the behaviour they pin. For a user-visible fix, add a line to
`CHANGELOG.md`; when the board changed, add a screenshot under `docs/ui/` and a
note in `docs/UI-REVIEW.md`.

## Reporting a bug

Include the plugin version, the DSH version, and the output of

```bash
node scripts/verify-live.mjs http://127.0.0.1:<port>
```

That separates "the code is wrong" from "the running host still serves an older
generation" — the usual cause is a hot reload that could not reclaim a route.
