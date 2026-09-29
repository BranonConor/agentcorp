# agentcorp live office experiment

This is a separate, read-only Copilot canvas extension. It does not alter the
playable game in `agent-inc/` or require its Next.js server. Its client lives in
`agent-inc-live/` and bundles the **same** `agent-inc/game/world.ts`,
`sprite-art.ts`, lighting and original `agent-inc/app/styles.css`. The scene,
pixel sprites, camera controls, and time-of-day preview stay shared with the
game. The live HUD places the lighting clock, then connection status, inline with
the pixel-lettered logo; the Activity panel shows real Copilot status in a
compact overlay. Opening Activity replaces the top-right summary without
covering the whole office. Escape or the close button unfocuses the worker and
returns to the summary.

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
allows a closer zoom than the playable game. The floor lamps cast warm light
onto nearby surfaces, and the pixel monsteras have broad split leaves
with larger cutouts. Only the live office uses
this decor and branding; the playable game retains its own room and name.
Additional desks appear beyond eight and disappear as workers leave, down
to eight visible desks. The room accommodates up to 16; extra workers remain
in the roster with a waiting-for-desk label. Notification bubbles use recognizable thinking, terminal, checks, search,
editing, delegation, general work, and attention icons based on the same
sanitized categories as the Activity panel, never raw tool data. A brief tool
action remains identifiable for up to five seconds after it finishes, even
if it completes between feed updates. The charcoal wall has warm sconce
wash that becomes more visible as the decorative room lighting dims. The
original game's layout is unchanged, though it shares the more defined
shadows, smooth idle motion, and monstera art.
The scene adapter moves actors around the dividers between the coffee counter
and desks without running the game's `Simulation.update()` or generating
fictional rewards.
The live canvas replaces the game's orange sky with a quiet neutral background
similar to the App's default surfaces. It switches between light and dark
colors with `prefers-color-scheme` while the room's decorative day/night
lighting continues independently. The canvas SDK does not currently expose
the App's selected theme or custom background tokens, so an in-App theme
override that differs from the browser preference may not be reflected.
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

The project extension loads in **game-labs sessions that contain this branch**.
It listens to SDK events from each attached session: turn start/end, generic
tool categories, assistant-message arrival, idle/error, and subagent
start/finish. The feed records up to eight **metadata-only** signals, including
"Assistant replied"; it does not copy the assistant's response text. Each participating
extension process writes a sanitized heartbeat into
`$COPILOT_HOME/extensions/agent-inc-live/artifacts/game-labs/` (or
`~/.copilot/extensions/...`). The canvas serves an SSE feed over an ephemeral
`127.0.0.1` port and shows recent participants in one office. Heartbeats
older than 35 seconds disappear. Raw prompts, tool arguments/results, filenames,
repository contents, and raw event payloads are not written or sent to the
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

## Sharing

This extension is project-scoped and currently runs only with this repository's
layout. It reads `agent-inc/app/styles.css` outside its own folder and shares
local activity through a `game-labs` directory. Installing only the extension
folder elsewhere, or sharing it as a standalone gist, will not work. Before
offering a one-folder install, bundle that stylesheet into the extension,
separate activity by project, add a `copilot-extension.json` manifest, and
publish a versioned repository folder or gist. Inside this repository, no
separate installation is needed: the project extension is discovered on
branches that contain it.

## Local test

1. The committed `office.bundle.js` is ready to run. To rebuild after editing
   either the client or the shared game scene, run `cd agent-inc-live && npm ci
   && npm run build && npm run typecheck && npm test`. The bundle uses React and Three.js
   only at build time; the extension needs no running Next.js dev server.
2. From the repo root, run `node --test .github/extensions/agent-inc-live/state.test.mjs`
   and `node --check .github/extensions/agent-inc-live/extension.mjs`.
3. In the App, reload extensions, inspect `agent-inc-live` if it fails to load,
   then open the **agentcorp** canvas. The agent can call
   `get_status` to inspect the same sanitized snapshot shown in the panel.
4. Run a tool and a subagent in this session; the session's desk and helper
   should update, then return to idle. For a second desk, open another
   game-labs session containing this extension, reload extensions there,
   and run a tool. Both sessions must share the same local `COPILOT_HOME`.

If a browser has no EventSource support or the loopback server disconnects,
the panel reports the interruption rather than inventing activity. Reloading
the extension reopens the canvas on a fresh loopback URL. The original
`agent-inc/` game and its port 3100 preview remain independent.

The SDK's canvas API is experimental. A full daily-chat office spanning
unrelated repos or remote hosts needs an opt-in user-wide installation and a
supported cross-session/host feed; installing this project-scoped extension
alone cannot provide that.
