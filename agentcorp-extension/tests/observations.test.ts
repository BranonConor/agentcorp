import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = await mkdtemp(join(tmpdir(), "agentcorp-observer-"));
process.env.COPILOT_HOME = directory;
const { heartbeat, snapshot, clearHeartbeat, dataDir, MAX_DESKS, MAX_PRESENCE_IDS, EXPIRY_MS, validPresenceIds } =
  await import("../../.github/extensions/agentcorp-extension/observations.mjs");
const now = 100_000;

async function writeRecord(name: string, value: unknown) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, name), JSON.stringify(value));
}

test.beforeEach(async () => { await rm(dataDir, { recursive: true, force: true }); });

test("preexisting and new producers appear without enrollment, even when the root is absent", async () => {
  assert.deepEqual(await snapshot("root", now), { root: "root", sessions: [], overflow: 0 });
  await assert.rejects(snapshot("../escape", now), /Invalid session ID/);

  await heartbeat("earlier", "idle", "earlier-owner", now - 5_000);
  assert.deepEqual(await snapshot("root", now), {
    root: "root", sessions: [{ id: "earlier", phase: "idle", present: true }], overflow: 0,
  });
  await heartbeat("newer", "tool", "newer-owner", now);
  await heartbeat("root", "idle", "root-owner", now);
  assert.deepEqual(await snapshot("root", now), {
    root: "root", sessions: [
      { id: "newer", phase: "tool", present: true },
      { id: "earlier", phase: "idle", present: true },
      { id: "root", phase: "idle", present: true },
    ], overflow: 0,
  });
});

test("expired, offline, future, and stopped heartbeats are not visible", async () => {
  await assert.rejects(heartbeat("bad-owner", "idle", "", now), /Invalid heartbeat owner/);
  await assert.rejects(heartbeat("bad-time", "idle", "owner", Number.NaN), /Invalid heartbeat time/);
  await heartbeat("edge", "blocked", "edge-owner", now - EXPIRY_MS);
  await heartbeat("expired", "tool", "expired-owner", now - EXPIRY_MS - 1);
  await heartbeat("future", "tool", "future-owner", now + 1);
  await heartbeat("offline", "offline", "offline-owner", now);
  await heartbeat("leaving", "idle", "leaving-owner", now);
  await clearHeartbeat("leaving", "other-owner");
  assert.deepEqual((await snapshot("root", now)).sessions, [
    { id: "edge", phase: "blocked", present: true },
    { id: "leaving", phase: "idle", present: true },
  ]);
  await clearHeartbeat("leaving", "leaving-owner");
  assert.deepEqual(await snapshot("root", now), {
    root: "root", sessions: [{ id: "edge", phase: "blocked", present: true }], overflow: 0,
  });
  assert.deepEqual(await snapshot("root", now + EXPIRY_MS + 2), {
    root: "root", sessions: [], overflow: 0,
  });
});

test("only valid heartbeat files and contents are read; private fields never leave the observer", async () => {
  await writeRecord("heartbeat-valid.json", {
    id: "valid", phase: "tool", owner: "private-owner", at: now,
    prompt: "private-prompt", code: "private-code", title: "private-title",
  });
  await writeRecord("root-root.json", { root: "root", links: [{ parent: "root", child: "intruder" }] });
  await writeRecord("heartbeat-..%2Fescape.json", { id: "intruder", phase: "tool", owner: "owner", at: now });
  await writeRecord("heartbeat-.json", { id: "", phase: "tool", owner: "owner", at: now });
  await writeRecord("heartbeat-ghost.json.tmp", { id: "ghost", phase: "tool", owner: "owner", at: now });
  await writeRecord(`heartbeat-${"a".repeat(129)}.json`, { id: "intruder", phase: "tool", owner: "owner", at: now });
  await mkdir(join(dataDir, "heartbeat-folder.json"));
  const outside = join(directory, "outside.json");
  await writeFile(outside, JSON.stringify({ id: "link", phase: "tool", owner: "owner", at: now }));
  await symlink(outside, join(dataDir, "heartbeat-link.json"));
  await writeRecord("heartbeat-wrong.json", { id: "other", phase: "tool", owner: "owner", at: now });
  await writeRecord("heartbeat-no-owner.json", { id: "no-owner", phase: "tool", at: now });
  await writeRecord("heartbeat-bad-phase.json", { id: "bad-phase", phase: "busy", owner: "owner", at: now });
  await writeRecord("heartbeat-coercion.json", {
    id: "coercion", phase: { toString: null, valueOf: null }, owner: "owner", at: now,
  });
  await writeRecord("heartbeat-bad-time.json", { id: "bad-time", phase: "tool", owner: "owner", at: "now" });
  await writeRecord("heartbeat-null.json", null);
  await writeFile(join(dataDir, "heartbeat-malformed.json"), "{invalid json");

  const result = await snapshot("root", now);
  assert.deepEqual(result, {
    root: "root", sessions: [{ id: "valid", phase: "tool", present: true }], overflow: 0,
  });
  assert.doesNotMatch(JSON.stringify(result), /private-owner|private-prompt|private-code|private-title|at/);
});

test("blocked, tool, and thinking sessions outrank idle with stable ID ties and exact overflow", async () => {
  await heartbeat("root", "idle", "root-owner", now);
  const groups = [["blocked", 5], ["tool", 5], ["thinking", 6]] as const;
  const expected = groups.flatMap(([phase, size]) =>
    Array.from({ length: size }, (_, index) => ({ id: `${phase}-${index}`, phase, present: true })));
  for (const [phase, size] of groups) {
    for (let index = 0; index < size; index++) {
      await heartbeat(`${phase}-${index}`, phase, "owner", now - index * 1_000);
    }
  }
  assert.equal(MAX_DESKS, 16);
  assert.deepEqual(await snapshot("root", now), { root: "root", sessions: expected, overflow: 1 });
  await heartbeat("thinking-5", "thinking", "owner", now);
  assert.deepEqual((await snapshot("root", now)).sessions, expected);

  await heartbeat("active-new", "tool", "owner", now - 40_000);
  assert.deepEqual(await snapshot("root", now), {
    root: "root",
    sessions: [
      ...expected.slice(0, 5),
      { id: "active-new", phase: "tool", present: true },
      ...expected.slice(5, 10),
      ...expected.slice(10, 15),
    ],
    overflow: 2,
  });
});

test("five live sessions are all visible without an overflow indicator", async () => {
  for (const [id, phase] of [
    ["root", "idle"], ["a", "idle"], ["b", "thinking"], ["c", "tool"], ["d", "blocked"],
  ] as const) await heartbeat(id, phase, "owner", now);
  assert.deepEqual(await snapshot("root", now), {
    root: "root",
    sessions: [
      { id: "d", phase: "blocked", present: true },
      { id: "c", phase: "tool", present: true },
      { id: "b", phase: "thinking", present: true },
      { id: "a", phase: "idle", present: true },
      { id: "root", phase: "idle", present: true },
    ],
    overflow: 0,
  });
});

test("presence checks distinguish overflow displacement from disconnects without exposing other IDs or fields", async () => {
  for (let index = 0; index < 18; index++) await heartbeat(`busy-${index}`, "tool", "private-owner", now);
  await heartbeat("previously-visible", "idle", "private-owner", now);
  await heartbeat("offline", "offline", "private-owner", now);
  await heartbeat("expired", "tool", "private-owner", now - EXPIRY_MS - 1);
  const before = await readFile(join(dataDir, "heartbeat-previously-visible.json"), "utf8");
  const ids = ["previously-visible", "offline", "expired", "missing"];
  const result = await snapshot("root", now, ids);
  assert.equal(result.sessions.length, 16);
  assert.equal(result.overflow, 3);
  assert.deepEqual(result.presence, { "previously-visible": true, offline: false, expired: false, missing: false });
  assert.doesNotMatch(JSON.stringify(result), /private-owner|owner|\"at\"/);
  assert.equal(await readFile(join(dataDir, "heartbeat-previously-visible.json"), "utf8"), before);
  await clearHeartbeat("previously-visible", "private-owner");
  assert.deepEqual((await snapshot("root", now, ids)).presence, {
    "previously-visible": false, offline: false, expired: false, missing: false,
  });
  await heartbeat("previously-visible", "thinking", "reconnected-owner", now);
  assert.equal((await snapshot("root", now, ids)).presence?.["previously-visible"], true);
  assert.equal(Object.hasOwn(await snapshot("root", now), "presence"), false);
});

test("presence requests validate and bound IDs before reading anything", async () => {
  assert.deepEqual(validPresenceIds([]), []);
  const full = Array.from({ length: MAX_PRESENCE_IDS }, (_, index) => `known-${index}`);
  assert.deepEqual(validPresenceIds(full), full);
  assert.throws(() => validPresenceIds([...full, "too-many"]), /Invalid presence ID list/);
  assert.throws(() => validPresenceIds(["same", "same"]), /Invalid presence ID list/);
  assert.throws(() => validPresenceIds(["../escape"]), /Invalid session ID/);
  assert.throws(() => validPresenceIds([""]), /Invalid session ID/);
  assert.throws(() => validPresenceIds([4]), /Invalid session ID/);
  assert.throws(() => validPresenceIds({}), /Invalid presence ID list/);
  await assert.rejects(snapshot("root", now, ["../escape"]), /Invalid session ID/);
});

test("older membership and extension-folder artifacts remain untouched but are not observed", async () => {
  const legacyDir = join(directory, "extensions", "agentcorp-observer", "artifacts");
  await mkdir(legacyDir, { recursive: true });
  const legacyGraph = JSON.stringify({ root: "root", links: [{ parent: "root", child: "old" }] });
  const legacyBeat = JSON.stringify({ id: "old", phase: "tool", owner: "old-owner", at: now });
  await writeFile(join(legacyDir, "root-root.json"), legacyGraph);
  await writeFile(join(legacyDir, "heartbeat-old.json"), legacyBeat);
  await heartbeat("current", "idle", "current-owner", now);
  const graph = join(dataDir, "root-root.json");
  await writeFile(graph, "{obsolete graph");

  await clearHeartbeat("old", "old-owner");
  assert.deepEqual(await snapshot("root", now), {
    root: "root", sessions: [{ id: "current", phase: "idle", present: true }], overflow: 0,
  });
  assert.equal(await readFile(graph, "utf8"), "{obsolete graph");
  assert.equal(await readFile(join(legacyDir, "root-root.json"), "utf8"), legacyGraph);
  assert.equal(await readFile(join(legacyDir, "heartbeat-old.json"), "utf8"), legacyBeat);
});

test("storage failures surface instead of being treated as an empty office", async () => {
  await writeFile(dataDir, "not a directory");
  await assert.rejects(snapshot("root", now), { code: "ENOTDIR" });
});

test.after(async () => { await rm(directory, { recursive: true, force: true }); });
