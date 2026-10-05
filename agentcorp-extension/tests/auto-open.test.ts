import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { autoOpenCanvas, readSettings, type AutoOpenSession } from "../../.github/extensions/agentcorp-extension/auto-open.mjs";

async function fixture(t: TestContext, settings: unknown = { autoOpen: true }) {
  const root = await mkdtemp(join(tmpdir(), "agentcorp-auto-open-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "settings.json");
  await writeFile(path, JSON.stringify(settings));
  const calls: (string | { canvasId: string; instanceId: string })[] = [];
  const openCanvases: { canvasId: string; instanceId: string }[] = [];
  const session: AutoOpenSession = {
    sessionId: "session-1",
    workspacePath: join(root, "workspace"),
    capabilities: { ui: { canvases: true } },
    rpc: {
      canvas: {
        async listOpen() {
          calls.push("list");
          return { openCanvases };
        },
        async open(input) {
          calls.push(input);
          openCanvases.push(input);
          return input;
        },
      },
    },
  };
  return { root, path, session, calls, openCanvases, workspace: join(root, "workspace") };
}

test("missing or omitted settings default to disabled", async t => {
  const { path, session, calls, workspace } = await fixture(t, {});
  assert.deepEqual(await readSettings(path), { autoOpen: false });
  assert.equal(await autoOpenCanvas(session, path), "disabled");
  await rm(path);
  assert.deepEqual(await readSettings(path), { autoOpen: false });
  assert.equal(await autoOpenCanvas(session, path), "disabled");
  assert.deepEqual(calls, []);
  await assert.rejects(readdir(workspace), { code: "ENOENT" });
});

test("accepts explicit enabled and disabled settings", async t => {
  const { path } = await fixture(t);
  assert.deepEqual(await readSettings(path), { autoOpen: true });
  await writeFile(path, '{"autoOpen":false}');
  assert.deepEqual(await readSettings(path), { autoOpen: false });
});

test("rejects invalid JSON and invalid setting shapes", async t => {
  const { path, session, calls, workspace } = await fixture(t);
  for (const text of ["{", "null", "[]", "true", '{"autoOpen":"true"}',
    '{"autoOpen":null}', '{"autoOpen":0}', '{"autoOpne":true}']) {
    await writeFile(path, text);
    await assert.rejects(readSettings(path), /AgentCorp settings/);
    await assert.rejects(autoOpenCanvas(session, path), /AgentCorp settings/);
  }
  assert.deepEqual(calls, []);
  await assert.rejects(readdir(workspace), { code: "ENOENT" });
});

test("surfaces settings read failures instead of silently disabling", async t => {
  const { root } = await fixture(t);
  await assert.rejects(readSettings(root), /Cannot read AgentCorp settings/);
});

test("non-canvas hosts do not read settings or invoke canvas RPCs", async t => {
  const { path, session, calls, workspace } = await fixture(t);
  await writeFile(path, "invalid JSON");
  for (const capabilities of [{}, { ui: {} }, { ui: { canvases: false } }]) {
    session.capabilities = capabilities;
    assert.equal(await autoOpenCanvas(session, path), "unsupported");
  }
  assert.deepEqual(calls, []);
  await assert.rejects(readdir(workspace), { code: "ENOENT" });
});

test("disabled auto-open makes no RPCs or startup record", async t => {
  const { path, session, calls, workspace } = await fixture(t, { autoOpen: false });
  assert.equal(await autoOpenCanvas(session, path), "disabled");
  assert.deepEqual(calls, []);
  await assert.rejects(readdir(workspace), { code: "ENOENT" });
});

test("enabled startup opens one stable panel and persists its record", async t => {
  const { path, session, calls, workspace } = await fixture(t);
  assert.equal(await autoOpenCanvas(session, path), "opened");
  assert.deepEqual(calls, ["list", {
    canvasId: "agentcorp-observer",
    instanceId: "office-startup",
  }]);
  const marker = join(workspace, "files", "agentcorp-auto-open-session-1.json");
  assert.deepEqual(JSON.parse(await readFile(marker, "utf8")), { version: 1 });
  if (process.platform !== "win32") {
    assert.equal((await stat(marker)).mode & 0o777, 0o600);
    assert.equal((await stat(join(workspace, "files"))).mode & 0o777, 0o700);
  }
});

test("an existing panel is not duplicated or focused", async t => {
  const { path, session, calls, openCanvases } = await fixture(t);
  openCanvases.push({ canvasId: "agentcorp-observer", instanceId: "manual-office" });
  assert.equal(await autoOpenCanvas(session, path), "already-open");
  assert.deepEqual(calls, ["list"]);
  openCanvases.length = 0;
  assert.equal(await autoOpenCanvas(session, path), "already-handled");
  assert.deepEqual(calls, ["list"]);
});

test("a closed startup panel stays closed after reload or resume", async t => {
  const { path, session, calls, openCanvases } = await fixture(t);
  await autoOpenCanvas(session, path);
  openCanvases.length = 0;
  calls.length = 0;
  assert.equal(await autoOpenCanvas({ ...session }, path), "already-handled");
  assert.deepEqual(calls, []);
});

test("a different session opens even if its workspace was copied", async t => {
  const { path, session, calls, openCanvases } = await fixture(t);
  await autoOpenCanvas(session, path);
  openCanvases.length = 0;
  calls.length = 0;
  assert.equal(await autoOpenCanvas({ ...session, sessionId: "session-2" }, path), "opened");
  assert.equal(calls.length, 2);
});

test("concurrent startup attempts only open once", async t => {
  const { path, session, calls } = await fixture(t);
  const outcomes = await Promise.all([
    autoOpenCanvas(session, path),
    autoOpenCanvas(session, path),
  ]);
  assert.deepEqual(outcomes.sort(), ["already-handled", "opened"]);
  assert.equal(calls.length, 2);
});

test("unrelated canvases do not suppress AgentCorp startup", async t => {
  const { path, session, openCanvases } = await fixture(t);
  openCanvases.push({ canvasId: "editor", instanceId: "notes" });
  assert.equal(await autoOpenCanvas(session, path), "opened");
});

test("failed canvas RPCs surface the error and allow a later retry", async t => {
  for (const method of ["listOpen", "open"]) {
    await t.test(method, async t => {
      const { path, session, workspace } = await fixture(t);
      const original = session.rpc.canvas;
      session.rpc.canvas = {
        ...original,
        [method]: async () => { throw new Error("RPC unavailable"); },
      };
      await assert.rejects(autoOpenCanvas(session, path), /RPC unavailable/);
      assert.deepEqual(await readdir(join(workspace, "files")), []);
      session.rpc.canvas = original;
      assert.equal(await autoOpenCanvas(session, path), "opened");
    });
  }
});

test("an uncertain open response never duplicates a panel on retry", async t => {
  const { path, session, calls, openCanvases } = await fixture(t);
  session.rpc.canvas.open = async input => {
    calls.push(input);
    openCanvases.push(input);
    throw new Error("Response lost");
  };
  await assert.rejects(autoOpenCanvas(session, path), /Response lost/);
  assert.equal(await autoOpenCanvas(session, path), "already-open");
  assert.equal(calls.filter(call => typeof call === "object").length, 1);
});

test("requires durable session state and a safe session ID", async t => {
  const { path, session, calls } = await fixture(t);
  await assert.rejects(autoOpenCanvas({ ...session, workspacePath: undefined }, path),
    /requires a session workspace/);
  await assert.rejects(autoOpenCanvas({ ...session, sessionId: "../invalid" }, path),
    /Invalid session ID/);
  assert.deepEqual(calls, []);
});

test("state write failures do not open an untracked panel", async t => {
  const { path, session, calls, workspace } = await fixture(t);
  await mkdir(workspace);
  await writeFile(join(workspace, "files"), "not a directory");
  await assert.rejects(autoOpenCanvas(session, path), { code: "EEXIST" });
  assert.deepEqual(calls, []);
});
