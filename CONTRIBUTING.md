# Contributing

Thanks for taking the time to improve `dsh-skill-eval`.

## Setup

```bash
pnpm install            # devDependencies only; runtime has no dependencies besides the DSH peer
node --test test/       # 280 tests
```

`npm test` runs `pretest` first, which rebuilds the browser bundle from
`client/*.js`.

## Changing the UI

- Edit `client/*.js`, then run `node scripts/build-client.mjs`. `client.js` is
  generated — never edit it by hand; `scripts/doctor.mjs` fails when it is stale.
- The board is the sidebar panel (`main` slot); the same settings form is mounted
  three ways: the native bundle-config seat, the in-panel dialog, and the
  standalone web page (`lib/settings.js` renders the latter).
- Wire hot reload for a dev checkout before iterating:
  [docs/DEV-RELOAD.md](docs/DEV-RELOAD.md). Without it, disable/enable only
  re-runs `apply` and the old module stays in the ESM cache.

## Changing the server or scoring

- Pure logic lives in `lib/`; `index.js` owns the tools, routes and lifecycle.
- New report fields belong in `lib/report.js` and are pinned by
  `test/report.test.js`; new routes need a versioned alias, because an older
  generation can keep the canonical path (see `docs/DEV-RELOAD.md`).
- `package.json` version and `client/03-data.js` `DATA_VERSION` must match —
  a test enforces it.

## Before a pull request

```bash
npm run build:fast      # client build + doctor (version/locale gates)
npm run lint
npx prettier --check .
node --test test/
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
