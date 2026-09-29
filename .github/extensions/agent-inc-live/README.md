# agentcorp live office

This is a read-only Copilot canvas extension. Its client lives in
`agent-inc-live/` and bundles the migrated scene source in
`agent-inc/game/` and the stylesheet in `agent-inc/app/styles.css`.
The installed extension does not need that source, a playable game, or a dev
server. The live HUD places the lighting clock, then connection status, inline
with the pixel-lettered logo; the Activity panel shows real Copilot status in
a compact overlay. Opening Activity replaces the top-right summary without
covering the whole office. Escape or the close button unfocuses the worker
and returns to the summary.

The canvas has no token economy or upgrades: its Activity panel summarizes
the attached session's lifetime usage and combines worker status, owning
sessions, and desk locations in one Workers tab. Its live-only scene variant
removes the AI core and context chamber and moves the coffee counter to the
back wall, with the first four idle agents gathering in front of it.
The original four desks stay in place. The live room is wider and deeper, with
glazed dividers and woven rugs defining the desk wings, a back aisle for
workers to pass through, window-side pixel monsteras, warm floor lamps, and
two bookcases. The first two wing desks on each side stay visible but dark
until workers join; their screens light up for both idle and active workers.
Idle wing workers fill a three-seat pixel sofa centered on each rug's edge;
the next three stand at separate spots beside it. The divider monsteras
stand beyond the wall ends, clear of those workers. Agents walk in their
normal sprite until seated, then settle into a sitting pose. Each desk has a stable, varied pair
of pixel accessories such as a plant, mug, lamp, books, notes, or headphones.
Powered screens use a soft glow outside the display rather than a glass glare.
The back wall has charcoal architectural panels and the counter keeps its
pixel-art proportions around an espresso machine and grinder. Soft steam
drifts from its cups, desk mugs, and the cups carried by idle workers; motion
stops when the canvas is hidden and rests when reduced motion is requested.
An original glowing pixel-smiley and hand-drawn pixel letters tie the HUD to
the **AGENTCORP** neon sign, with matching purple lettering. The live view
allows a closer zoom. The floor lamps cast warm light
onto nearby surfaces, and the pixel monsteras have broad split leaves
with larger cutouts.
Additional desks appear beyond eight and disappear as workers leave, down
to eight visible desks. The room accommodates up to 16; extra workers remain
in the roster with a waiting-for-desk label. Notification bubbles use recognizable thinking, terminal, checks, search,
editing, delegation, general work, and attention icons based on the same
sanitized categories as the Activity panel, never raw tool data. A brief tool
action remains identifiable for up to five seconds after it finishes, even
if it completes between feed updates. The charcoal wall has warm sconce
wash that becomes more visible as the decorative room lighting dims.
The scene adapter moves actors around the dividers between the coffee counter
and desks without running `Simulation.update()` or generating
fictional rewards.
The live canvas uses a quiet neutral background
similar to the App's default surfaces. It switches between light and dark
colors with `prefers-color-scheme` while the room's decorative day/night
lighting continues independently. The renderer does not consume the App's
mirrored theme tokens, so an in-App theme override that differs from the
browser preference may not be reflected.
Each worker has a stable, generated display name. Its card shows the owning
session's SDK display title when available (which may differ from the host
App's sidebar name). Long SDK names are omitted rather than exposing what
may be the opening prompt; other sessions then show a short identifier and
the attached session shows "Your session." Hovering its sprite shows its
name. Clicking the sprite or the card's Focus button follows that worker;
Unfocus and closing the panel restore the previous camera view. Dragging or
zooming also clears focus. Workers beyond the 16-desk room remain in the roster and cannot be
focused in the scene. Each card labels its owning session. Direct App-session
links are not available: the canvas SDK supplies session IDs but no App URL
or host navigation action, so the office cannot safely synthesize a link.
Names are cosmetic and do not rename App sessions.

The project extension loads in sessions that contain this repository's extension;
it can also be installed from its repository folder into another project or a
user's extension directory.
It listens to SDK events from each attached session: turn start/end, generic
tool categories, assistant-message arrival, idle/error, and subagent
start/finish. The feed records up to eight **metadata-only** signals, including
"Assistant replied"; it does not copy the assistant's response text. Each participating
extension process writes a sanitized heartbeat into
`$COPILOT_HOME/extensions/agent-inc-live/artifacts/<project-key>/` (or
`~/.copilot/extensions/...`). The project key is a hash of the SDK's repository
host and slug, independent of its branch or worktree. If the SDK lacks a slug,
a local GitHub origin supplies the same identity; other local Git worktrees
use their shared Git common directory, and a non-Git folder uses its canonical
path. Remote sessions without repository identity cannot join a room. The
canvas serves an SSE feed over an ephemeral
`127.0.0.1` port and shows recent participants in one office. Heartbeats
older than 35 seconds disappear. Prompt and output bodies, tool arguments/results,
filenames, repository contents, and raw event payloads are not copied to the
page. The short SDK display title is the only potentially prompt-derived
metadata shown when available. This local experiment does not establish the
App's parent/child session relationships or expose navigation and controls:
child sessions of child sessions show as flat peers if they run this extension
and share the same local heartbeat directory. In-session helpers remain
separate sprites attached to their own session.
The feed keeps up to 32 fresh sessions; at most 16 workers occupy the room
simultaneously to bound rendering cost.

Overview reads the experimental session-scoped `usage.getMetrics` API for the
attached session. It shows input plus output tokens since that session opened,
including its in-session helpers, along with model calls, cached input tokens,
files changed, and lines added. Separately opened child sessions may appear
as workers, but their tokens are not added to these session-scoped totals.
Only the start time and derived
counts reach this canvas; model names and file paths from the SDK never enter
the shared heartbeat or browser response. If the API is unavailable, the
panel reports that explicitly instead of presenting a zero.

## Install

Use the Copilot app's extension installer with this
[GitHub repository-folder URL](https://github.com/BranonConor/agentcorp/tree/main/.github/extensions/agent-inc-live),
or pin the
[v0.1.0 release](https://github.com/BranonConor/agentcorp/tree/v0.1.0/.github/extensions/agent-inc-live).
Install to user scope to enable it in sessions across your local repositories,
or to project scope for one checkout. The folder contains the manifest,
entry point, HTML, JavaScript bundle, both stylesheets, state helpers, and
`THIRD_PARTY_NOTICES.txt` for the bundled dependencies. The notices do not
license agentcorp's own code. The extension does not need `agent-inc/`,
`agent-inc-live/`, `node_modules`, or a dev
server at runtime. This repository's project extension is discovered
automatically on branches containing it. Reload extensions after installing.
If another project already has an extension named `agent-inc-live`, that
project copy shadows a user-scope installation; try the new release in a
project without the older extension.

## Local test

1. The committed `office.bundle.js` and `styles.css` are ready to run. From the
   repo root, rebuild and check after editing the client, shared game scene,
   or stylesheet:

   ```sh
   npm ci --prefix agent-inc-live
   npm run build --prefix agent-inc-live
   npm run typecheck --prefix agent-inc-live
   npm test --prefix agent-inc-live
   node --check .github/extensions/agent-inc-live/extension.mjs
   ```

   The build copies `agent-inc/app/styles.css` byte-for-byte; bundles React,
   React DOM, Scheduler, and Three.js; and generates third-party notices from
   each bundled package's MIT license. Commit the rebuilt assets with source
   changes. Tests cover
   sanitized state, project isolation, asset and notice equivalence, room
   layout, and original game simulation.
2. In the App, reload extensions, inspect `agent-inc-live` if it fails to load,
   then open the **agentcorp** canvas. The agent can call
   `get_status` to inspect the same sanitized snapshot shown in the panel.
3. Run a tool and a subagent in this session; the session's desk and helper
   should update, then return to idle. For a second desk, open another
   session in the same repository with this extension, reload extensions there,
   and run a tool. Both sessions must share the same local `COPILOT_HOME`.

If a browser has no EventSource support or the loopback server disconnects,
the panel reports the interruption rather than inventing activity. Reloading
the extension reopens the canvas on a fresh loopback URL. No game preview
server is needed.

The SDK's canvas API is experimental. Even when installed user-wide, rooms stay
project-isolated: unrelated repos and remote hosts cannot share live activity
through this local heartbeat directory. Spanning hosts would require a
separate, supported cross-host feed.
