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
Copilot extensions. Reinstall from the same URL to update an existing install
when `main` changes. The GitHub repository must be accessible to the
device/account, and the Copilot app must support extension canvases. Do not
copy `agentcorp-extension/` as the install folder: it holds build sources, not
the packaged `extension.mjs` and viewer.

The project copy shadows a user copy with the same `agentcorp-extension` name.
If the older `agentcorp-observer-viewer` user install is still present, it
continues to own the canvas until you remove it through the app's extension
management; the new copy stays inactive to avoid duplicate providers. Do not
remove the old install during an active session unless you intend to switch.

Only this session and explicitly enrolled App-created descendants appear;
`add_descendant` enrolls known child session IDs, not all repository sessions
or subagents. At most 16 desks are shown. Missing/expired heartbeats go offline
after 45 seconds. Activity is a small phase-only snapshot (idle, thinking,
tool, blocked, offline), not prompts, code, output, session titles, or
cross-device activity. Storage is local to the device's `COPILOT_HOME`, in
`agentcorp-observer/artifacts` outside the installed extension folder; older
`extensions/agentcorp-observer/artifacts` records are copied on demand and
left intact. Installing/reinstalling does not require writing into a live
extension folder for heartbeat updates.

For the viewer build and tests, see [the source guide](agentcorp-extension/README.md).
