# Client sources

`client.js` at the package root is **generated** from the files here by
`node scripts/build-client.mjs`. Do not edit it directly.

- Each `NN-*.js` file is a plain JavaScript snippet that runs inside the
  `window.__ModuleLoader__.load({ factory(require) { … } })` scope. They share
  lexical scope, so a snippet may reference declarations from any part that
  runs earlier; there are no imports or exports.
- `parts.json` is the ordered file list. Add a part there when you split a
  section; the file order is the execution order.
- After editing a part:
  ```bash
  node scripts/build-client.mjs
  touch client.js            # let the DSH HMR watcher pick up the built binary
  ```
- `node scripts/build-client.mjs --check` verifies the shipped file matches the
  sources; `doctor` and `npm test` run it through `pretest`.
- `client/` is source-only and is not part of the npm tarball; the package ships
  the generated `client.js`.
