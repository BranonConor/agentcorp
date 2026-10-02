import { randomUUID } from "node:crypto";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { autoOpenCanvas } from "./auto-open.mjs";
import { clearHeartbeat, heartbeat, validId } from "./observations.mjs";
import { shouldRegister } from "./provider-selection.mjs";
import { startServer } from "./viewer-server.mjs";

const owner = randomUUID();
const servers = new Map();
let phase = "idle";
let writing = Promise.resolve();
let stopped = false;
let timer;
const active = await shouldRegister(import.meta.url);

const session = await joinSession({
  canvases: active ? [createCanvas({
    id: "agentcorp-observer",
    displayName: "AgentCorp · Live sessions",
    description: "Read-only 3D office for fresh local AgentCorp heartbeat producers.",
    open: async ({ instanceId, sessionId }) => {
      let entry = servers.get(instanceId);
      if (!entry) {
        entry = await startServer(sessionId);
        servers.set(instanceId, entry);
      }
      return { title: "AgentCorp · Live sessions", url: entry.url };
    },
    onClose: async ({ instanceId }) => {
      const entry = servers.get(instanceId);
      if (entry) {
        servers.delete(instanceId);
        await new Promise((done, reject) => entry.server.close(error => error ? reject(error) : done()));
      }
    },
  })] : [],
});

if (!active) console.error("AgentCorp observer inactive: another user-scope observer owns this canvas.");
const id = validId(session.sessionId);
function publish(next) {
  phase = next;
  writing = writing.then(() => heartbeat(id, phase, owner)).catch(error => {
    console.error("AgentCorp heartbeat failed:", error);
  });
}
if (active) {
  publish("idle");
  timer = setInterval(() => publish(phase), 10_000);
  timer.unref();
  for (const [event, next] of [
    ["user.message", "thinking"],
    ["assistant.turn_start", "thinking"],
    ["tool.execution_start", "tool"],
    ["tool.execution_complete", "thinking"],
    ["permission.requested", "blocked"],
    ["permission.completed", "thinking"],
    ["assistant.turn_end", "idle"],
    ["session.idle", "idle"],
    ["session.error", "offline"],
  ]) session.on(event, () => publish(next));
  process.on("SIGTERM", () => { void shutdown().catch(error => console.error("AgentCorp shutdown failed:", error)); });
  process.on("SIGINT", () => { void shutdown().catch(error => console.error("AgentCorp shutdown failed:", error)); });
  try {
    console.error(`AgentCorp auto-open: ${await autoOpenCanvas(session)}.`);
  } catch (error) {
    console.error("AgentCorp auto-open failed:", error);
  }
}

async function shutdown() {
  if (stopped) return;
  stopped = true;
  clearInterval(timer);
  await writing;
  await clearHeartbeat(id, owner);
  await Promise.all([...servers.values()].map(entry => new Promise(done => entry.server.close(done))));
}
