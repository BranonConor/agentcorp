# AgentCorp extension

Read-only live-session office for the GitHub Copilot app.

## Automatically open the office

In the canvas, open **Manage agents** and toggle **Open automatically in new
sessions** under Office preferences. Saving does not open, close, or refocus
the current panel. The control updates the same setting described below and
reports read/save errors without claiming success.

Create or edit `~/.copilot/extensions/agentcorp-extension/artifacts/settings.json`:

```json
{
  "autoOpen": true
}
```

Set `autoOpen` to `false` to disable automatic opening. A missing settings file
or omitted `autoOpen` defaults to `false`.
If `COPILOT_HOME` is set, it replaces `~/.copilot` in the settings path.
Invalid JSON, unknown settings, and non-boolean values are reported in the
extension log rather than silently accepted.

The setting is read when the active canvas provider starts. It applies across
projects in canvas-capable app sessions; ordinary CLI sessions are unaffected.
The office opens directly through the SDK, without sending a prompt or making
a model call.

An existing AgentCorp panel is left alone, without opening a duplicate or
changing focus. Once handled, startup is recorded in the session workspace:
closing the office keeps it closed on resume, extension reload, and app restart.
A new session gets its own startup record. Disabling auto-open does not close an
existing panel, and you can still ask the agent to open the office manually.

Reload extensions to reread settings in a running session. Reloading never
overrides an existing startup record. If opening fails, the error is logged,
manual opening remains available, and a later reload can retry.

Back up this settings file before removing or reinstalling the extension, then
restore it to keep your preference. It is separate from the office's heartbeat
data under `$COPILOT_HOME/agentcorp-observer/artifacts/`.

## Motion preferences

The canvas's **Motion** selector provides **System**, **Reduced**, and **Full**.
System follows `prefers-reduced-motion` live. Reduced hides walking and disables
decorative motion, while phase messages and farewells stay readable and logical
arrivals/departures continue safely. Changes take effect immediately and persist
across reloads in a separate `artifacts/viewer-preferences.json` file:

```json
{ "motion": "reduced" }
```

A missing motion file defaults to System. Do not add `motion` to `settings.json`,
which remains autoOpen-only. Preferences are saved atomically through a bounded,
same-origin local API; observation/heartbeat APIs remain read-only.
