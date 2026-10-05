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
the next snapshot; there is no direct-path or teleport fallback.

New avatars queue outside the two front-corner entrances and walk to their
assigned destination. At first actual entry they say "Hello!" for 2.5 seconds.
Greeting history lasts for this viewer, not globally: polls, retargets and
reconnects never replay it, including returning after a completed departure.
Waiting-for-user and departure messages have priority over greetings.
Cooperative traffic reserves complete swept routes:
nonconflicting routes run together, while conflicting agents wait. When an
occupied destination or a head-on encounter blocks progress, one agent pulls
over to a reachable clear floor point and then returns to its destination.
Body clearance includes seated positions and the sit/stand sweep. Planning
is throttled to 0.3-second intervals; movement accelerates and brakes using
elapsed time, turns toward the next leg, and still never rounds a corner
through furniture. Agents retain their identity across polls and retargets.
Seat reservations include the physical seat, not just its walking approach, and
remain held until the sit/stand interaction finishes. A sitter waiting to leave
also retains clearance to its approach so a replacement cannot block it in.
The full 16-agent polling/compaction regression checks every physical swept
pair, including intermediate seat transfers rather than only final positions.

When a previously displayed session goes offline, expires, or stops, its avatar
waits through a 4-second reconnect grace period and a fresh repeat confirmation
that it is still missing, says goodbye for 1.8 seconds,
and takes the shortest safe route to either front
corner exit. Departures are not counted as connected or assigned a desk.
Reconnecting cancels the departure and immediately invalidates departure-owned
labels, even if rendering is paused or a slot is reused. Responses older than
one polling interval are rejected; failed/late polls leave the roster alone
and cannot confirm a goodbye. A genuine exit route can pass desks on its way
out, but connected desk/lounge travel never produces a farewell.
The snapshot endpoint optionally accepts repeated `presence=<session-id>`
parameters (up to 64 unique valid IDs) and returns only booleans for those
requested IDs, using the same fresh-heartbeat scan before the top-16 limit.
Thus overflow displacement does not trigger a false goodbye. No heartbeat
writes, freshness changes, or extra private session details are involved.
Farewells use the existing animation loop rather than per-agent timers;
an office with 64 retained active/departing avatars reports backpressure
until exits clear rather than silently discarding a departure.

Status bubbles are derived only from observed phases: "Working...", "Using
a tool", "Waiting for you", and "Ready". They debounce for 0.5 seconds and
rate-limit routine messages to once per 8 seconds. Waiting-for-user remains
visible, and farewells take precedence; no prompts, tool arguments, or inferred
task outcomes are shown.

The gear menu contains exactly Dark Mode, Reduced Motion, Auto Start and Chat
Bubbles as native-checkbox-backed slide switches. Space or Enter toggles a
focused switch; row labels are clickable. It supports keyboard focus,
Escape/outside-click dismissal, and a viewport-bounded popover. The popover has
the office's shared light/dark palette applied directly to the body portal,
with an opaque panel and readable fallback colors. Enabled switches stay green;
off tracks, text, focus and error colors adapt to the selected office theme.
Theme colors change immediately without animating unrelated switch thumbs.
Contrast checks parse both source and emitted CSS: labels exceed 4.5:1 and
borders/focus exceed 3:1 in both themes.
Thumb transitions follow effective reduced motion. Reduced Motion defaults to the OS
`prefers-reduced-motion` setting; existing `system/reduced/full` values remain
valid, and toggling saves `reduced` or `full`. Reduced mode keeps agents visible
while walking and yielding, with the same routes, acceleration, turns and
walking poses as full motion. Speech bubbles follow their agents. Bobbing,
swaying, decorative motion, seat transitions and smooth camera transitions
are disabled; arrivals, reconnect grace and exits still complete. Overrides persist in
`$COPILOT_HOME/extensions/agentcorp-extension/artifacts/viewer-preferences.json`,
not port-scoped localStorage. Theme (`system/light/dark`) and `chatBubbles`
also live in this viewer file. An absent Chat Bubbles preference defaults to
enabled; absent theme preserves the current legacy theme/OS behavior until an
explicit choice is saved. Hidden bubbles still process phase changes, cooldowns
and farewell timing, so re-enabling does not replay expired messages.
The existing `artifacts/settings.json` remains strictly autoOpen-only; Auto
Start uses its shared reader and validation without changing panel markers.
Preferences save only on explicit interaction; unknown/failed loads disable
the controls and errors retain the last saved values. Pending saves block
additional input without restyling unrelated switches or animating them when
Reduced Motion is turned off. Saves show no transient message or reserved
status space; failures still show an error. `/api/preferences`
accepts only GET and same-origin PUT with a 256-byte JSON body changing exactly
one allow-listed preference. Atomic read-modify-write updates use a process-owned
loopback mutex: a stable port in 20000-39999 is derived from the canonical
settings directory. The OS releases it on process death; connections are
immediately destroyed, and endpoint contention fails explicitly after bounded
retries (it never permits unlocked writes).

A compatibility marker is published by hard-linking completely written owner
metadata. Recovery of known abandoned markers happens only while holding the
kernel mutex, so competing recoverers cannot unlink a newly acquired writer.
A crash before publication leaves no ambiguous shared marker. No age threshold
is used to steal locks from slow live writers. Tests in
`tests/preference-lock.test.ts` kill the real fixture owner in
`tests/fixtures/preference-lock-owner.mjs` at kernel acquisition, partial
metadata preparation, and marker publication; they also cover concurrent
recoverers, live contention and connected clients.

Legacy empty or unrecognized `viewer-preferences.lock` files cannot prove that
an old provider has stopped. They fail closed. Stop **all** old extension
providers first, then remove only that lock file from the extension's artifacts
directory and restart; do not remove either saved preferences file. Observation
endpoints remain read-only.

The observer clock samples the browser's current local `Date` for each visible
frame. The header and lighting consume that same sample, independent of movement
simulation time. Sleep/resume, timezone/DST and system-clock changes are reflected
on the next frame rather than extrapolated from a cached origin. Six-hour
previews are temporary offsets from real wall time; the fourth press resets the
offset to zero. Agent/lifecycle speeds and explicit theme preferences are
unchanged. The non-observer demo retains its independent 240-second day.
