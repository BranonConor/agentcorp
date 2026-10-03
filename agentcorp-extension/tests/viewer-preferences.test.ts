import assert from "node:assert/strict";
import { test } from "node:test";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const home = await mkdtemp(join(tmpdir(), "agentcorp-preferences-"));
process.env.COPILOT_HOME = home;
const { readSettings, settingsPath, autoOpenCanvas } = await import("../../.github/extensions/agentcorp-extension/auto-open.mjs");
const { motionPath, readPreferences, savePreference } = await import("../../.github/extensions/agentcorp-extension/viewer-preferences.mjs");
const { startServer } = await import(pathToFileURL(join(process.cwd(), "../.github/extensions/agentcorp-extension/viewer-server.mjs")).href);
const { server, url } = await startServer("preferences-test");
const origin = new URL(url).origin;
const get = () => fetch(new URL("/api/preferences", url));
const put = (value: unknown, headers: Record<string, string> = {}) => fetch(new URL("/api/preferences", url), {
  method: "PUT", headers: { "Content-Type": "application/json", Origin: origin, ...headers }, body: JSON.stringify(value),
});

test.beforeEach(async () => { await rm(dirname(settingsPath), { recursive: true, force: true }); });

test("default/current settings are read without writes, and explicit motion/auto-open saves stay separate", async () => {
  assert.deepEqual(await (await get()).json(), { autoOpen: false, motion: "system", chatBubbles: true });
  await assert.rejects(readFile(settingsPath), { code: "ENOENT" });
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, '{ "autoOpen": true }\n');
  const original = await readFile(settingsPath, "utf8");
  assert.deepEqual(await (await get()).json(), { autoOpen: true, motion: "system", chatBubbles: true });
  assert.deepEqual(await (await put({ motion: "reduced" })).json(), { autoOpen: true, motion: "reduced", chatBubbles: true });
  assert.equal(await readFile(settingsPath, "utf8"), original);
  const motion = await readFile(motionPath, "utf8");
  assert.deepEqual(await (await put({ autoOpen: false })).json(), { autoOpen: false, motion: "reduced", chatBubbles: true });
  assert.equal(await readFile(motionPath, "utf8"), motion);
  assert.deepEqual(await readSettings(), { autoOpen: false });
  assert.deepEqual(await (await put({ autoOpen: true })).json(), { autoOpen: true, motion: "reduced", chatBubbles: true });
  assert.equal(await readFile(motionPath, "utf8"), motion);
  assert.equal((await readdir(dirname(settingsPath))).some(name => name.endsWith(".tmp")), false);
});

test("motion overrides survive server restarts and different loopback ports", async () => {
  await savePreference({ motion: "full" });
  const second = await startServer("preferences-new-session");
  try {
    assert.notEqual(second.url, url);
    assert.deepEqual(await (await fetch(new URL("/api/preferences", second.url))).json(), { motion: "full", autoOpen: false, chatBubbles: true });
    await savePreference({ motion: "system" });
    assert.deepEqual(await readPreferences(), { motion: "system", autoOpen: false, chatBubbles: true });
  } finally { await new Promise<void>(resolve => second.server.close(resolve)); }
});

test("preference writes require matching origin, JSON, a bounded allow-listed schema and the fixed endpoint", async () => {
  for (const value of [{}, null, [], { autoOpen: "true" }, { motion: "fast" },
    { autoOpen: true, motion: "full" }, { path: "/tmp/anything" }, { motion: "x".repeat(300) },
    { chatBubbles: "false" }, { theme: true }, { theme: "blue" }]) {
    assert.equal((await put(value)).status, 400);
  }
  assert.equal((await put({ autoOpen: true }, { Origin: "http://evil.example" })).status, 403);
  assert.equal((await put({ autoOpen: true }, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await put({ autoOpen: true }, { "Content-Type": "text/plain" })).status, 415);
  const noOrigin = await fetch(new URL("/api/preferences", url), {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: '{"autoOpen":true}',
  });
  assert.equal(noOrigin.status, 403);
  assert.equal((await fetch(new URL("/api/preferences?path=elsewhere", url))).status, 400);
  assert.equal((await fetch(new URL("/api/preferences", url), { method: "POST" })).status, 405);
  assert.equal((await fetch(new URL("/api/observations", url), { method: "PUT" })).status, 405);
  assert.deepEqual(await readPreferences(), { autoOpen: false, motion: "system", chatBubbles: true });
});

test("malformed and unreadable preferences surface failures instead of clobbering user data", async () => {
  await mkdir(dirname(settingsPath), { recursive: true });
  for (const invalid of ["{invalid", '{"autoOpen":"yes"}', '{"autoOpen":true,"motion":"full"}']) {
    await writeFile(settingsPath, invalid);
    assert.equal((await get()).status, 500);
    assert.equal((await put({ autoOpen: false })).status, 500);
    assert.equal(await readFile(settingsPath, "utf8"), invalid);
  }
  await writeFile(settingsPath, '{"autoOpen":true}');
  await writeFile(motionPath, '{"motion":"fast"}');
  assert.equal((await get()).status, 500);
  assert.equal((await put({ autoOpen: false })).status, 500);
  assert.equal(await readFile(settingsPath, "utf8"), '{"autoOpen":true}');
  await rm(motionPath);
  await mkdir(motionPath);
  assert.equal((await get()).status, 500);
});

test("failed atomic saves are reported and retain the old value", { skip: process.getuid?.() === 0 }, async () => {
  await savePreference({ motion: "reduced" });
  await chmod(dirname(settingsPath), 0o500);
  try {
    assert.equal((await put({ motion: "full" })).status, 500);
    assert.deepEqual(await readPreferences(), { autoOpen: false, motion: "reduced", chatBubbles: true });
  } finally { await chmod(dirname(settingsPath), 0o700); }
});

test("old motion-only files remain valid and each toggle preserves the other saved fields", async () => {
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, '{"autoOpen":true}');
  for (const motion of ["system", "reduced", "full"]) {
    const old = JSON.stringify({ motion });
    await writeFile(motionPath, old);
    assert.deepEqual(await (await get()).json(), { motion, autoOpen: true, chatBubbles: true });
    assert.equal(await readFile(motionPath, "utf8"), old, "Loading must not rewrite existing preferences");
  }
  await put({ theme: "dark" });
  await put({ chatBubbles: false });
  await put({ motion: "reduced" });
  assert.deepEqual(await readPreferences(), { theme: "dark", chatBubbles: false, motion: "reduced", autoOpen: true });
  const viewer = await readFile(motionPath, "utf8");
  await put({ autoOpen: false });
  assert.equal(await readFile(motionPath, "utf8"), viewer);
  assert.deepEqual(await readSettings(), { autoOpen: false });
  await put({ theme: "light" });
  assert.deepEqual(await readPreferences(), { theme: "light", chatBubbles: false, motion: "reduced", autoOpen: false });
});

test("concurrent independent providers and rapid API updates do not lose unrelated fields", async () => {
  const module = new URL("../../.github/extensions/agentcorp-extension/viewer-preferences.mjs", import.meta.url).href;
  await Promise.all([{ theme: "dark" }, { motion: "reduced" }, { chatBubbles: false }, { autoOpen: true }].map(update =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e",
        `const {savePreference}=await import(${JSON.stringify(module)});await savePreference(${JSON.stringify(update)});`],
      { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", reject);
      child.on("exit", code => code === 0 ? resolve() : reject(new Error(stderr)));
    })));
  assert.deepEqual(await readPreferences(), { theme: "dark", motion: "reduced", chatBubbles: false, autoOpen: true });
  const results = await Promise.all([{ theme: "light" }, { motion: "full" }, { chatBubbles: true }, { autoOpen: false }].map(update => put(update)));
  results.forEach(response => assert.equal(response.status, 200));
  assert.deepEqual(await readPreferences(), { theme: "light", motion: "full", chatBubbles: true, autoOpen: false });
  assert.equal((await readdir(dirname(settingsPath))).some(name => name.endsWith(".lock") || name.endsWith(".tmp")), false);
});

test("a busy preference lock reports failure without replacing the existing saved state", async () => {
  await savePreference({ chatBubbles: false });
  const lock = join(dirname(settingsPath), "viewer-preferences.lock");
  await writeFile(lock, "");
  try {
    assert.equal((await put({ chatBubbles: true })).status, 500);
    assert.equal((await readPreferences()).chatBubbles, false);
  } finally { await rm(lock); }
});

test("auto-open UI changes affect only later startup, never close/refocus the current panel or reset markers", async () => {
  let calls = 0;
  const session = {
    sessionId: "settings-session", workspacePath: join(home, "session"), capabilities: { ui: { canvases: true } },
    rpc: { canvas: {
      listOpen: async () => { calls++; return { openCanvases: [] }; },
      open: async () => { calls++; },
    } },
  };
  await put({ autoOpen: true });
  assert.equal(calls, 0);
  assert.equal(await autoOpenCanvas(session), "opened");
  assert.equal(calls, 2);
  await put({ autoOpen: false });
  assert.equal(calls, 2);
  assert.equal(await autoOpenCanvas(session), "disabled");
  await put({ autoOpen: true });
  assert.equal(await autoOpenCanvas(session), "already-handled");
  assert.equal(calls, 2);
});

test.after(async () => {
  await new Promise<void>(resolve => server.close(resolve));
  await rm(home, { recursive: true, force: true });
});
