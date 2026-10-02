import assert from "node:assert/strict";
import { test } from "node:test";
import { request } from "node:http";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const source = resolve("../.github/extensions/agentcorp-extension");
const folder = await mkdtemp(join(tmpdir(), "agentcorp-portable-"));
const installed = join(folder, "extensions", "agentcorp-extension");
await cp(source, installed, { recursive: true });
process.env.COPILOT_HOME = folder;
const { shouldRegister } = await import(pathToFileURL(join(installed, "provider-selection.mjs")).href);
const { startServer } = await import(pathToFileURL(join(installed, "viewer-server.mjs")).href);
const { heartbeat, dataDir } = await import(pathToFileURL(join(installed, "observations.mjs")).href);
const { autoOpenCanvas } = await import(pathToFileURL(join(installed, "auto-open.mjs")).href);

test("standalone extension folder serves only packaged assets and sanitized local status", async t => {
  const manifest = JSON.parse(await readFile(join(installed, "copilot-extension.json"), "utf8"));
  assert.equal(manifest.name, "agentcorp-extension");
  assert.equal(await shouldRegister(pathToFileURL(join(installed, "extension.mjs")).href, folder), true);
  for (const notice of ["LICENSE", "THIRD_PARTY_NOTICES.txt"]) {
    assert.ok((await readFile(join(installed, notice), "utf8")).length > 0);
  }
  const entry = await readFile(join(installed, "extension.mjs"), "utf8");
  assert.doesNotMatch(entry, /\.\.\/\.\.\/\.\.\/dist/);
  assert.doesNotMatch(entry, /add_descendant/);
  assert.match(entry, /shouldRegister/);
  const { server, url } = await startServer("root");
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /AgentCorp · Live sessions/);
    const references = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(match => match[1]);
    assert.ok(references.some(path => path.endsWith(".js")));
    assert.ok(references.some(path => path.endsWith(".css")));
    for (const reference of references) {
      const asset = await fetch(new URL(reference, url));
      assert.equal(asset.status, 200, reference);
      assert.ok((await asset.arrayBuffer()).byteLength > 0, reference);
    }
    const assets = await readdir(join(installed, "viewer", "assets"));
    assert.deepEqual(assets.sort(), references.map(path => path.split("/").at(-1)!).sort());
    await mkdir(join(folder, "agentcorp-observer"), { recursive: true });
    await t.test("returns HTTP 500 when local artifacts cannot be scanned", async () => {
      await writeFile(dataDir, "not a directory");
      try {
        const failure = await fetch(new URL("/api/observations", url), { signal: AbortSignal.timeout(3_000) });
        assert.equal(failure.status, 500);
        assert.equal(await failure.text(), "Office update unavailable.");
      } finally {
        await rm(dataDir, { force: true });
      }
    });
    const state = await (await fetch(new URL("/api/observations", url))).json();
    assert.deepEqual(state, { root: "root", sessions: [], overflow: 0 });
    assert.equal((await fetch(new URL("/index.html", url))).status, 404);
    assert.equal((await fetch(new URL("/../package.json", url))).status, 404);
    assert.equal((await fetch(url, { method: "POST" })).status, 405);
    const wrongHostStatus = await new Promise<number>((done, reject) => {
      const call = request(url, { headers: { host: "not-localhost.example" } }, response => {
        response.resume();
        done(response.statusCode ?? 0);
      });
      call.on("error", reject);
      call.end();
    });
    assert.equal(wrongHostStatus, 403);
    const packageFiles = await readdir(installed);
    await heartbeat("before-root", "idle", "private-owner");
    await heartbeat("root", "tool", "test-owner");
    await writeFile(join(dataDir, "heartbeat-extra.json"), JSON.stringify({
      id: "extra", phase: "thinking", owner: "private-extra-owner", at: Date.now(),
      prompt: "private-prompt", code: "private-code", title: "private-title",
    }));
    const live = await (await fetch(new URL("/api/observations", url))).json();
    assert.deepEqual(live, { root: "root", sessions: [
      { id: "root", phase: "tool", present: true },
      { id: "extra", phase: "thinking", present: true },
      { id: "before-root", phase: "idle", present: true },
    ], overflow: 0 });
    assert.doesNotMatch(JSON.stringify(live), /private-|test-owner/);
    assert.deepEqual(await readdir(installed), packageFiles);
    assert.equal((await readdir(dataDir)).length, 3);
  } finally {
    await new Promise<void>((done, reject) => server.close((error?: Error) => error ? reject(error) : done()));
  }
});

test("standalone auto-open reads user settings from COPILOT_HOME and records startup outside the package", async () => {
  const calls: (string | { canvasId: string; instanceId: string })[] = [];
  const session = {
    sessionId: "portable",
    workspacePath: join(folder, "session-state", "portable"),
    capabilities: { ui: { canvases: true } },
    rpc: {
      canvas: {
        async listOpen() {
          calls.push("list");
          return { openCanvases: [] };
        },
        async open(input: { canvasId: string; instanceId: string }) {
          calls.push(input);
          return input;
        },
      },
    },
  };
  assert.equal(await autoOpenCanvas(session), "disabled");
  assert.deepEqual(calls, []);
  await mkdir(join(installed, "artifacts"));
  await writeFile(join(installed, "artifacts", "settings.json"), '{"autoOpen":true}');
  assert.equal(await autoOpenCanvas(session), "opened");
  assert.deepEqual(calls, ["list", {
    canvasId: "agentcorp-observer",
    instanceId: "office-startup",
  }]);
  assert.deepEqual(await readdir(join(installed, "artifacts")), ["settings.json"]);
  assert.deepEqual(await readdir(join(session.workspacePath, "files")), ["agentcorp-auto-open-portable.json"]);
  calls.length = 0;
  assert.equal(await autoOpenCanvas(session), "already-handled");
  assert.deepEqual(calls, []);
});

test.after(async () => { await rm(folder, { recursive: true, force: true }); });
