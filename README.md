# agentcorp

A read-only 3D office for local Copilot session activity. The canvas extension
is in [`.github/extensions/agent-inc-live/`](.github/extensions/agent-inc-live/)
and is discovered automatically in sessions using this repository. Its scene
source lives in `agent-inc/game/` and its React client in `agent-inc-live/`;
neither a dev server nor `node_modules` is needed to run the built extension.

## Install

In the Copilot app, install the
[agent-inc-live repository folder](https://github.com/BranonConor/agentcorp/tree/main/.github/extensions/agent-inc-live)
by URL. Choose user scope to use the office in other repositories, or project
scope to enable it only in one checkout. After installation, reload extensions
and open the **agentcorp** canvas. Copies of this folder alone include all
runtime assets; no source files from the rest of this repository are required.

## Build and test

From the repository root (Node.js 22+):

```sh
npm ci --prefix agent-inc-live
npm run build --prefix agent-inc-live
npm run typecheck --prefix agent-inc-live
npm test --prefix agent-inc-live
node --check .github/extensions/agent-inc-live/extension.mjs
```

The build bundles React, Three.js, and the shared game scene into
`office.bundle.js` and copies the scene stylesheet into `styles.css` inside
the installable folder. Commit both generated assets with source changes.

The office writes only sanitized activity heartbeats under
`$COPILOT_HOME/extensions/agent-inc-live/artifacts/` (default `~/.copilot`),
separated by a hash of the SDK repository identity, a GitHub origin, the local
Git common directory, or a non-Git folder. It does not copy prompt or output
bodies, tool arguments, filenames, model names, or file contents into the
heartbeat or page. Short SDK session display titles are shown and may be
prompt-derived. Usage totals are for the attached
session (including its in-session helpers), not for separately opened child
sessions. Only sessions running this extension on the same machine with the
same `COPILOT_HOME` can appear together; other projects have separate rooms.
See the [extension README](.github/extensions/agent-inc-live/README.md) for
scope, limitations, and the live office's behavior.
