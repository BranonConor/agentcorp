import assert from "node:assert/strict";
import { test } from "node:test";
import { request } from "node:http";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const source = resolve("../.github/extensions/agentcorp-extension");
const folder = await mkdtemp(join(tmpdir(), "agentcorp-portable-"));
const installed = join(folder, "extensions", "agentcorp-extension");
await cp(source, installed, { recursive: true });
process.env.COPILOT_HOME = folder;
const { startServer } = await import(pathToFileURL(join(installed, "viewer-server.mjs")).href);
const { heartbeat } = await import(pathToFileURL(join(installed, "observations.mjs")).href);

test("standalone extension folder serves only packaged observer assets and scoped status", async () => {
  const manifest = JSON.parse(await readFile(join(installed, "copilot-extension.json"), "utf8"));
  assert.equal(manifest.name, "agentcorp-extension");
  const entry = await readFile(join(installed, "extension.mjs"), "utf8");
  assert.doesNotMatch(entry, /\.\.\/\.\.\/\.\.\/dist/);
  assert.match(entry, /shouldRegister/);
  await readFile(join(installed, "provider-selection.mjs"));
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
    const state = await (await fetch(new URL("/api/observations", url))).json();
    assert.deepEqual(state, { root: "root", sessions: [{ id: "root", phase: "offline", present: false }] });
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
    await heartbeat("root", "tool", "test-owner");
    const live = await (await fetch(new URL("/api/observations", url))).json();
    assert.deepEqual(live, { root: "root", sessions: [{ id: "root", phase: "tool", present: true }] });
    assert.deepEqual(await readdir(installed), packageFiles);
    assert.equal((await readdir(join(folder, "agentcorp-observer", "artifacts"))).length, 1);
  } finally {
    await new Promise<void>((done, reject) => server.close((error?: Error) => error ? reject(error) : done()));
  }
});

test.after(async () => { await rm(folder, { recursive: true, force: true }); });
