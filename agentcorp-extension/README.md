# AgentCorp observer source

This directory contains the TSX viewer, scene art, styles, build tooling and
focused tests for the installable
[`agentcorp-extension`](../.github/extensions/agentcorp-extension). The package
contains the standalone observer runtime and prebuilt viewer adapted from the
local `agentcorp-harness` source at
`a208847207abc295d8c9f638f14cd6e665e06dfc`, with user-scope provider
selection and automatic local heartbeat discovery. No harness checkout, Vite
server or `node_modules` is needed by the installed package.

The runtime `.mjs` files are maintained directly in the installable folder;
only the viewer assets are generated. Startup auto-open is opt-in; see the
[settings guide](../.github/extensions/agentcorp-extension/README.md#automatically-open-the-office).

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
Auto-open tests cover settings validation, canvas capability gating, durable
once-per-session startup, concurrency and RPC retries. The standalone package
test also verifies settings lookup under `COPILOT_HOME` and keeps startup records
in the session workspace rather than the installed package.

Live movement uses a visibility graph around the furniture footprints shared
with the renderer (including all 16 desks, chairs, sofas, dividers and floor
props). Obstacles are expanded for the agent's body and ground depth. Each
complete segment is checked, and movement stops at each corner before the
next leg so render interpolation cannot cut through furniture. Desk targets
remain in the working gap ahead of the chair; sofa targets use a walkable
front approach followed by a short visual sit/stand transition. Retargeting
starts at the current position, including during a sit/stand transition.
Unreachable routes stop the agent and surface an office error, retried on
the next snapshot; there is no direct-path or teleport fallback. This is
static-furniture navigation, not agent-to-agent collision avoidance.

When a previously displayed session goes offline, expires, or stops, its avatar
says goodbye for 1.8 seconds and takes the shortest safe route to either front
corner exit. Departures are not counted as connected or assigned a desk.
Reconnecting cancels the departure; failed polls leave the roster alone.
The snapshot endpoint optionally accepts repeated `presence=<session-id>`
parameters (up to 64 unique valid IDs) and returns only booleans for those
requested IDs, using the same fresh-heartbeat scan before the top-16 limit.
Thus overflow displacement does not trigger a false goodbye. No heartbeat
writes, freshness changes, or extra private session details are involved.
Farewells use the existing animation loop rather than per-agent timers;
an office with 64 retained active/departing avatars reports backpressure
until exits clear rather than silently discarding a departure.
