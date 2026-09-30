# AgentCorp observer source

This directory contains the TSX viewer, scene art, styles, build tooling and
focused tests for the installable
[`agentcorp-extension`](../.github/extensions/agentcorp-extension). The package
contains the standalone observer runtime and prebuilt viewer adapted from the
local `agentcorp-harness` source at
`a208847207abc295d8c9f638f14cd6e665e06dfc`, with user-scope provider
selection and automatic local heartbeat discovery. No harness checkout, Vite
server or `node_modules` is needed by the installed package.

From this directory:

```sh
npm ci
npm run typecheck
npm test
npm run package:observer
```

`package:observer` regenerates the committed
`../.github/extensions/agentcorp-extension/viewer/` assets and checks that
all references resolve, with no extra generated files. Commit changes to
both source and generated viewer when changing the art or UI. Tests copy the
installable folder to a temporary home to check that it serves independently,
does not expose files outside `viewer/`, and returns only fresh, sanitized,
at-most-16-session snapshots with an aggregate overflow count. Observer
layout tests also keep scene identity stable when those sessions change
priority or leave the visible office.
