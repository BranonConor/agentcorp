import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentcorp-observer-"));
process.env.COPILOT_HOME = directory;
const { heartbeat, enroll, snapshot, clearHeartbeat, dataDir, MAX_DESKS, EXPIRY_MS } =
  await import("../../.github/extensions/agentcorp-extension/observations.mjs");
const legacyDir = join(directory, "extensions", "agentcorp-observer", "artifacts");

test("only the activated root is visible without explicit membership", async () => {
  await heartbeat("root", "idle", "root-owner", 1000);
  await heartbeat("unrelated", "tool", "other-owner", 1000);
  assert.deepEqual(await snapshot("root", 1000), {
    root: "root", sessions: [{ id: "root", phase: "idle", present: true }],
  });
});

test("explicit children and grandchildren appear; unrelated and unlinked sessions do not", async () => {
  await enroll("root", "root", "child");
  await assert.rejects(enroll("root", "unrelated", "intruder"), /Parent must already/);
  await enroll("root", "child", "grandchild");
  await heartbeat("child", "thinking", "child-owner", 1000);
  await heartbeat("grandchild", "blocked", "grandchild-owner", 1000);
  const result = await snapshot("root", 1000);
  assert.deepEqual(result.sessions, [
    { id: "root", phase: "idle", present: true },
    { id: "child", phase: "thinking", present: true },
    { id: "grandchild", phase: "blocked", present: true },
  ]);
  assert.equal(JSON.stringify(result).includes("unrelated"), false);
});

test("stale, missing, and stopped participants are offline without fabricated activity", async () => {
  const result = await snapshot("root", 1000 + EXPIRY_MS + 1);
  assert.ok(result.sessions.every(member => member.phase === "offline" && !member.present));
  await heartbeat("root", "tool", "new-owner", 1000);
  await clearHeartbeat("root", "old-owner");
  assert.equal((await snapshot("root", 1000)).sessions[0].phase, "tool");
  await clearHeartbeat("root", "new-owner");
  assert.equal((await snapshot("root", 1000)).sessions[0].phase, "offline");
  await heartbeat("root", "offline", "new-owner", 1000);
  assert.deepEqual((await snapshot("root", 1000)).sessions[0],
    { id: "root", phase: "offline", present: false });
});

test("membership is capped and rejects duplicate or invalid descendants", async () => {
  await assert.rejects(enroll("root", "root", "child"), /already enrolled/);
  await assert.rejects(enroll("root", "root", "../escape"), /Invalid session ID/);
  for (let i = 3; i < MAX_DESKS; i++) await enroll("root", "root", `child-${i}`);
  await assert.rejects(enroll("root", "root", "overflow"), /Office is full/);
  assert.equal((await snapshot("root")).sessions.length, MAX_DESKS);
});

test("migrates legacy membership and recent heartbeats without touching the extension folder", async () => {
  assert.equal(dataDir, join(directory, "agentcorp-observer", "artifacts"));
  await mkdir(legacyDir, { recursive: true });
  const graph = JSON.stringify({ root: "migrated-root", links: [{ parent: "migrated-root", child: "migrated-child" }] });
  const beat = JSON.stringify({ id: "migrated-child", phase: "tool", owner: "legacy-owner", at: 1000 });
  const graphPath = join(legacyDir, "root-migrated-root.json");
  const beatPath = join(legacyDir, "heartbeat-migrated-child.json");
  await writeFile(graphPath, graph);
  await writeFile(beatPath, beat);
  assert.deepEqual((await snapshot("migrated-root", 1000)).sessions, [
    { id: "migrated-root", phase: "offline", present: false },
    { id: "migrated-child", phase: "tool", present: true },
  ]);
  assert.equal(await readFile(graphPath, "utf8"), graph);
  assert.equal(await readFile(beatPath, "utf8"), beat);
  assert.equal(await readFile(join(dataDir, "root-migrated-root.json"), "utf8"), graph);
  assert.equal(await readFile(join(dataDir, "heartbeat-migrated-child.json"), "utf8"), beat);
  await clearHeartbeat("migrated-child", "legacy-owner");
  assert.equal((await snapshot("migrated-root", 1000)).sessions[1].phase, "offline");
  assert.equal(await readFile(beatPath, "utf8"), beat);
  await heartbeat("migrated-child", "thinking", "new-owner", 1000);
  await rm(legacyDir, { recursive: true });
  assert.equal((await snapshot("migrated-root", 1000)).sessions[1].phase, "thinking");
});

test("canonical membership and heartbeat override an older legacy snapshot", async () => {
  await mkdir(legacyDir, { recursive: true });
  await writeFile(join(legacyDir, "root-canonical-root.json"),
    JSON.stringify({ root: "canonical-root", links: [{ parent: "canonical-root", child: "old-child" }] }));
  await writeFile(join(legacyDir, "heartbeat-canonical-root.json"),
    JSON.stringify({ id: "canonical-root", phase: "thinking", owner: "legacy-owner", at: 1000 }));
  await enroll("canonical-root", "canonical-root", "new-child");
  await heartbeat("canonical-root", "idle", "current-owner", 1000);
  assert.deepEqual((await snapshot("canonical-root", 1000)).sessions, [
    { id: "canonical-root", phase: "idle", present: true },
    { id: "old-child", phase: "offline", present: false },
    { id: "new-child", phase: "offline", present: false },
  ]);
  await clearHeartbeat("canonical-root", "current-owner");
  assert.equal((await snapshot("canonical-root", 1000)).sessions[0].phase, "offline");
});

test.after(async () => { await rm(directory, { recursive: true, force: true }); });
