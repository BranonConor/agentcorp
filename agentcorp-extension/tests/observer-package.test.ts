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
    const presence = await (await fetch(new URL("/api/observations?presence=root&presence=missing", url))).json();
    assert.deepEqual(presence, { ...live, presence: { root: true, missing: false } });
    for (const query of ["presence=", "presence=..%2Fescape", "presence=root&presence=root",
      Array.from({ length: 65 }, (_, i) => `presence=id-${i}`).join("&")]) {
      const invalid = await fetch(new URL(`/api/observations?${query}`, url));
      assert.equal(invalid.status, 400, query);
      assert.equal(await invalid.text(), "Invalid presence ID list.");
    }
    assert.deepEqual(await readdir(installed), packageFiles);
    assert.equal((await readdir(dataDir)).length, 3);
  } finally {
    await new Promise<void>((done, reject) => server.close((error?: Error) => error ? reject(error) : done()));
  }
});

test.after(async () => { await rm(folder, { recursive: true, force: true }); });
