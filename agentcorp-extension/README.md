# AgentCorp observer source

This directory contains the TSX viewer, scene art, styles, build tooling and
focused tests for the installable
[`agentcorp-extension`](../.github/extensions/agentcorp-extension). The package
contains the exact standalone observer runtime and prebuilt viewer from the
local `agentcorp-harness` source at
`a208847207abc295d8c9f638f14cd6e665e06dfc`, with the extension name and
user-scope provider selection migrated. No harness checkout, Vite server or
`node_modules` is needed by the installed package.

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
does not expose files outside `viewer/`, and returns only the enrolled
phase-only observation snapshot.
