# agentcorp

![Isometric pixel-art AgentCorp office with desk wings, sofas, plants, and a coffee counter](assets/agentcorp-office.png)

## Bring your agents to life. 

A cozy office for local Copilot session agents. :)

## Install on this or another device

In the Copilot app on each device, ask:

```text
Install the agentcorp-extension from
https://github.com/BranonConor/agentcorp/tree/main/.github/extensions/agentcorp-extension
in my user scope, then open the AgentCorp · Live sessions canvas.
```

The repo-folder URL is the input to the app's `install_extension` flow;
installing from a repo folder copies the portable package into that device's
Copilot extensions. The installer will not overwrite an existing copy. To
update a user-scope install when `main` changes, remove it through the app's
extension management or move `$COPILOT_HOME/extensions/agentcorp-extension/`
outside the `extensions/` directory as a backup. Disabling it without removing
the folder does not free the install path. Reinstall from the same URL, then
reload extensions if they were not reloaded automatically. Keep
`$COPILOT_HOME/agentcorp-observer/artifacts/` intact: it holds local office data
outside the installed package. `$COPILOT_HOME` defaults to `~/.copilot`.

The GitHub repository must be accessible to the device/account, and the
Copilot app must support extension canvases. Do not copy `agentcorp-extension/`
as the install folder: it holds build sources, not the packaged `extension.mjs`
and viewer.

Both project and user copies can launch here. When both are installed, the user
copy owns the canvas; without it, the project copy serves the canvas. Renamed
copies also defer to the canonical user install to avoid duplicate providers.
If the older `agentcorp-observer-viewer` user install is still present, it
continues to own the canvas until you remove it through the app's extension
management; the new copy stays inactive to avoid duplicate providers. Do not
remove the old install during an active session unless you intend to switch.

Every fresh AgentCorp heartbeat under the same local `COPILOT_HOME` appears
automatically in every office, including sessions opened earlier or outside
this repo or an App parent/child tree. No enrollment is needed. A session must
have loaded the extension and be publishing to appear; resume or reload older
sessions that have not started a producer. This does not observe subagents
without their own producer or activity on other devices.

At most 16 sessions are shown. Blocked, tool, and thinking activity take
priority over idle sessions, with a stable session-ID order within each phase;
the office's own session is not guaranteed a desk. Additional fresh sessions
are counted as "more sessions," not rendered as individual agents. Offline
heartbeats are hidden, cleanly stopped sessions disappear, and unrefreshed
heartbeats expire after 45 seconds. Observations include only session IDs and
phases (idle, thinking, tool, blocked), not prompts, code, output, or session
titles. Storage stays local to the device's `COPILOT_HOME`, in
`agentcorp-observer/artifacts` outside the installed extension folder.
Older membership records and `extensions/agentcorp-observer/artifacts` files
are left intact but are not used for live discovery.

For the viewer build and tests, see [the source guide](agentcorp-extension/README.md).
