import assert from "node:assert/strict";
import { test } from "node:test";
import { fork, spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const home = await mkdtemp(join(tmpdir(), "agentcorp-process-lock-"));
process.env.COPILOT_HOME = home;
const preferencesUrl = new URL("../../.github/extensions/agentcorp-extension/viewer-preferences.mjs", import.meta.url).href;
const { readPreferences, savePreference } = await import("../../.github/extensions/agentcorp-extension/viewer-preferences.mjs");
const { settingsPath } = await import("../../.github/extensions/agentcorp-extension/auto-open.mjs");
const { claimPreferenceLock, preferenceLockPort } = await import("../../.github/extensions/agentcorp-extension/preference-lock.mjs");
const startServer = (await import(new URL("../../.github/extensions/agentcorp-extension/viewer-server.mjs", import.meta.url).href)).startServer;
const directory = dirname(settingsPath);
const fixture = fileURLToPath(new URL("./fixtures/preference-lock-owner.mjs", import.meta.url));

async function owner(stage: string) {
  const child = fork(fixture, [preferencesUrl, stage, '{"theme":"dark"}'], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  let stderr = "";
  child.stderr!.on("data", chunk => { stderr += chunk; });
  const exit = new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve); child.once("error", reject);
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`Fixture did not acquire ${stage}: ${stderr}`)); }, 10_000);
    child.once("message", () => { clearTimeout(timeout); resolve(); });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Fixture exited ${code}: ${stderr}`)); });
    child.once("error", error => { clearTimeout(timeout); reject(error); });
  });
  return { child, exit };
}

async function apiSave(update: object) {
  const { server, url } = await startServer("fresh-lock-provider");
  try {
    const response = await fetch(new URL("/api/preferences", url), {
      method: "PUT", headers: { "Content-Type": "application/json", Origin: new URL(url).origin }, body: JSON.stringify(update),
    });
    return { status: response.status, body: await response.text() };
  } finally { await new Promise<void>(resolve => server.close(resolve)); }
}

test.beforeEach(async () => { await rm(directory, { recursive: true, force: true }); });

test("a new provider recovers actual process death before publication, during metadata preparation, and after publication", async () => {
  for (const stage of ["kernel", "partial-metadata", "published"]) {
    await savePreference({ theme: "light" });
    const writer = await owner(stage);
    writer.child.kill("SIGKILL");
    await writer.exit;
    assert.equal(writer.child.signalCode, "SIGKILL");
    assert.equal((await readPreferences()).theme, "light");
    const result = await apiSave({ theme: "dark" });
    assert.equal(result.status, 200, `${stage}: ${result.body}`);
    assert.equal((await readPreferences()).theme, "dark");
  }
});

test("an active slow owner is never stolen and can finish after bounded contention", async () => {
  await savePreference({ theme: "light" });
  const writer = await owner("published");
  try {
    const marker = await readFile(join(directory, "viewer-preferences.lock"), "utf8");
    const result = await apiSave({ chatBubbles: false });
    assert.equal(result.status, 500);
    assert.equal(await readFile(join(directory, "viewer-preferences.lock"), "utf8"), marker);
    assert.equal((await readPreferences()).theme, "light");
    writer.child.send("release");
    assert.equal(await writer.exit, 0);
    assert.equal((await apiSave({ chatBubbles: false })).status, 200);
    assert.deepEqual(await readPreferences(), { motion: "system", theme: "dark", chatBubbles: false, autoOpen: false });
  } finally { if (writer.child.exitCode === null && writer.child.signalCode === null) { writer.child.kill("SIGKILL"); await writer.exit; } }
});

test("simultaneous recoverers serialize and preserve independent settings", async () => {
  await savePreference({ theme: "light" });
  const writer = await owner("published");
  writer.child.kill("SIGKILL"); await writer.exit;
  await Promise.all([{ theme: "dark" }, { chatBubbles: false }, { motion: "reduced" }, { autoOpen: true }].map(update =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e",
        `const {savePreference}=await import(${JSON.stringify(preferencesUrl)});await savePreference(${JSON.stringify(update)});`],
      { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", reject);
      child.on("exit", code => code === 0 ? resolve() : reject(new Error(stderr)));
    })));
  assert.deepEqual(await readPreferences(), { theme: "dark", motion: "reduced", chatBubbles: false, autoOpen: true });
});

test("canonical aliases share a mutex; client connections cannot retain it after release", async () => {
  await mkdir(directory, { recursive: true });
  const alias = join(home, "artifact-alias");
  await symlink(directory, alias, "junction");
  const port = await preferenceLockPort(directory);
  assert.equal(await preferenceLockPort(alias), port);
  const release = await claimPreferenceLock(directory);
  const client = createConnection({ host: "127.0.0.1", port });
  client.on("error", error => { assert.ok("code" in error && error.code === "ECONNRESET"); });
  await new Promise<void>(resolve => client.once("close", resolve));
  await release();
  const again = await claimPreferenceLock(alias);
  await again();
});

test("unrelated endpoint contention and legacy empty markers fail closed without deleting anything", async () => {
  await savePreference({ theme: "light" });
  const port = await preferenceLockPort(directory);
  const unrelated = createServer();
  await new Promise<void>(resolve => unrelated.listen(port, "127.0.0.1", resolve));
  try {
    assert.equal((await apiSave({ theme: "dark" })).status, 500);
    assert.equal(unrelated.listening, true);
    assert.equal((await readPreferences()).theme, "light");
  } finally { await new Promise<void>(resolve => unrelated.close(() => resolve())); }
  const marker = join(directory, "viewer-preferences.lock");
  await writeFile(marker, "");
  assert.equal((await apiSave({ theme: "dark" })).status, 500);
  assert.equal(await readFile(marker, "utf8"), "");
  assert.equal((await readPreferences()).theme, "light");
});

test.after(async () => { await rm(home, { recursive: true, force: true }); });
