# Client sources

`client.js` at the package root is **generated** from the files here. Do not
edit it directly.

- Each `NN-*.ts` file is a TypeScript snippet that runs inside the
  `window.__ModuleLoader__.load({ factory(require) { … } })` scope. They share
  lexical scope, so a snippet may reference declarations from any part that
  runs earlier; there are no imports or exports, and a name may not be
  declared twice across parts.
- `parts.json` is the ordered file list. Add a part there when you split a
  section; the file order is the execution order.
- `globals.d.ts` declares the loader scope (browser globals, `React`,
  `__SEV_ENABLE_POPUP__`); `tsc -p src/client` type-checks the snippets and
  runs as part of `npm run typecheck`.
- After editing a part:
  ```bash
  npm run build:client
  touch client.js            # let the DSH HMR watcher pick up the built binary
  ```
- `node scripts/build-client.mjs --check` verifies the shipped file matches the
  sources. `npm run build:client` emits that runner with `tsc` first. `doctor`
  and `npm test` run the check through `pretest`.
- `src/client/` is source-only and is not part of the npm tarball; the package
  ships the generated `client.js`.
