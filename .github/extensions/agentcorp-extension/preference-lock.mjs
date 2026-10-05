import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { link, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const protocol = "agentcorp-preferences-port-v1";
const attempts = 100;
const retryMs = 20;

export async function preferenceLockPort(directory) {
  const canonical = await realpath(directory);
  return 20_000 + createHash("sha256").update(canonical).digest().readUInt32BE(0) % 20_000;
}

const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));

async function claimKernelMutex(directory) {
  const port = await preferenceLockPort(directory);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const server = createServer({ pauseOnConnect: true }, socket => socket.destroy());
    const error = await new Promise(resolve => {
      const failed = error => resolve(error);
      server.once("error", failed);
      server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
        server.removeListener("error", failed);
        resolve(null);
      });
    });
    if (!error) return server;
    if (error.code !== "EADDRINUSE") throw error;
    await delay(retryMs);
  }
  throw new Error(`Office preferences mutex is busy on loopback port ${port}; no settings were changed.`);
}

function recoverableMarker(text) {
  let value;
  try { value = JSON.parse(text); }
  catch (error) { if (error instanceof SyntaxError) return false; throw error; }
  return value && Object.keys(value).length === 2 && value.protocol === protocol &&
    typeof value.owner === "string" && /^[0-9a-f-]{36}$/.test(value.owner);
}

export async function claimPreferenceLock(directory) {
  const server = await claimKernelMutex(directory);
  const marker = join(directory, "viewer-preferences.lock");
  const owner = randomUUID();
  const content = JSON.stringify({ protocol, owner });
  const staging = join(directory, `.viewer-preferences-owner-${owner}.tmp`);
  try {
    // Publish complete metadata atomically, so a death during preparation cannot leave an ambiguous shared marker.
    await writeFile(staging, content, { flag: "wx", mode: 0o600 });
    let acquired = false;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await link(staging, marker);
        acquired = true;
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
      let existing;
      try { existing = await readFile(marker, "utf8"); }
      catch (error) { if (error?.code === "ENOENT") continue; throw error; }
      if (recoverableMarker(existing)) {
        // Only the kernel mutex owner may recover. No other new writer can publish a marker until we release it.
        await rm(marker);
      } else {
        // Old providers use empty markers without the kernel mutex; never guess whether that writer is dead.
        await delay(retryMs);
      }
    }
    if (!acquired) throw new Error("Legacy or unrecognized viewer-preferences.lock: stop all old providers before manually removing that lock. Settings were not changed.");
    await rm(staging);
    return async () => {
      try {
        if (await readFile(marker, "utf8") !== content) throw new Error("Preference lock ownership changed unexpectedly.");
        await rm(marker);
      } finally { await close(server); }
    };
  } catch (error) {
    try { await rm(staging, { force: true }); }
    finally { await close(server); }
    throw error;
  }
}
