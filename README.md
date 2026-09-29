# agentcorp

A silly, cozy 3D office for real local Copilot agents.
Watch their desks light up and see who's at the coffee counter.
It's read-only: a little window into work, not a way to manage it.

## Move in

Paste this into a Copilot app chat:

```text
Install the agent-inc-live extension from
https://github.com/BranonConor/agentcorp/tree/v0.1.0/.github/extensions/agent-inc-live
in my user scope, then open the agentcorp canvas.
```

Only local Copilot sessions running this extension in the same project
share a room; snapshots omit prompt, code, and output bodies, though
short SDK session titles may be prompt-derived.

If a project already includes `agent-inc-live`, it shadows your user
install; try another repository.

For builders and curious office visitors, see the
[extension guide](.github/extensions/agent-inc-live/README.md).
