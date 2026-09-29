import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFile, readdir, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import {
  applyEvent, createState, isPublicSnapshot, normalizeTitle, publicSnapshot, selectRoom, summarizeUsageMetrics,
} from "./state.mjs";

const assets = dirname(fileURLToPath(import.meta.url));
const gameStyles = resolve(assets, "../../../agent-inc/app/styles.css");
const room = join(process.env.COPILOT_HOME || join(homedir(), ".copilot"),
  "extensions", "agent-inc-live", "artifacts", "game-labs");
const servers = new Map();
let session;
let state;
let file;
let writing = Promise.resolve();
let usageError;

async function publish() {
  const snapshot = JSON.stringify(publicSnapshot(state));
  const temp = `${file}.tmp`;
  writing = writing.then(async () => {
    await writeFile(temp, snapshot, { mode: 0o600 });
    await rename(temp, file);
  });
  return writing;
}

async function readRoom() {
  const files = (await readdir(room)).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
  const snapshots = await Promise.all(files.map(async (name) => {
    let contents;
    try {
      contents = await readFile(join(room, name), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (contents.length > 4096) throw new Error(`Oversized office status file: ${name}`);
    const value = JSON.parse(contents);
    if (!isPublicSnapshot(value)) throw new Error(`Invalid office status file: ${name}`);
    return value;
  }));
  return { ...selectRoom(snapshots, session.sessionId), attachedUsage: await readAttachedUsage() };
}

async function readAttachedUsage() {
  try {
    const usage = summarizeUsageMetrics(await session.rpc.usage.getMetrics());
    usageError = undefined;
    return usage;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (usageError !== reason) {
      usageError = reason;
      await session.log(`Agent Inc Live session totals unavailable: ${reason}`, { level: "error" });
    }
    return { status: "unavailable" };
  }
}

async function startServer(instanceId) {
  const clients = new Set();
  let expectedHost;
  const files = {
    "/": ["office.html", "text/html; charset=utf-8"],
    "/live.css": ["live.css", "text/css; charset=utf-8"],
    "/office.bundle.js": ["office.bundle.js", "text/javascript; charset=utf-8"],
  };
  const server = createServer(async (req, res) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (req.method !== "GET" || host !== expectedHost ||
      (origin && origin !== `http://${host}`)) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'");
    try {
      const path = new URL(req.url, `http://${host}`).pathname;
      if (path === "/state") {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify(await readRoom()));
      } else if (path === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.write(`data: ${JSON.stringify(await readRoom())}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
      } else if (path === "/styles.css") {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
        res.end(await readFile(gameStyles));
      } else if (files[path]) {
        const [name, type] = files[path];
        res.setHeader("Content-Type", type);
        res.end(await readFile(join(assets, name)));
      } else {
        res.writeHead(404).end("Not found");
      }
    } catch (error) {
      await session.log(`Agent Inc Live canvas: ${error.message}`, { level: "error" });
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Office status unavailable");
      } else {
        res.write(`event: error\ndata: ${JSON.stringify({ message: "Office status unavailable" })}\n\n`);
      }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  expectedHost = `127.0.0.1:${server.address().port}`;
  const timer = setInterval(async () => {
    if (!clients.size) return;
    try {
      const message = `data: ${JSON.stringify(await readRoom())}\n\n`;
      for (const client of clients) client.write(message);
    } catch (error) {
      await session.log(`Agent Inc Live status feed: ${error.message}`, { level: "error" });
      for (const client of clients) client.write('event: error\ndata: {"message":"Office status unavailable"}\n\n');
    }
  }, 2000);
  return {
    url: `http://${expectedHost}/`,
    async close() {
      clearInterval(timer);
      for (const client of clients) client.end();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

session = await joinSession({
  canvases: [createCanvas({
    id: "agent-inc-live",
    displayName: "agentcorp",
    description: "Read-only office for sanitized activity from local Copilot sessions running this extension.",
    actions: [{
      name: "get_status",
      description: "Read current sanitized office session and subagent activity.",
      handler: async () => readRoom(),
    }],
    open: async ({ instanceId }) => {
      let server = servers.get(instanceId);
      if (!server) {
        server = await startServer(instanceId);
        servers.set(instanceId, server);
      }
      return { title: "agentcorp", url: server.url };
    },
    onClose: async ({ instanceId }) => {
      const server = servers.get(instanceId);
      if (server) {
        servers.delete(instanceId);
        await server.close();
      }
    },
  })],
});

state = createState(session.sessionId);
async function refreshTitle() {
  const { name } = await session.rpc.name.get();
  state.title = normalizeTitle(name);
}
await refreshTitle();
await mkdir(room, { recursive: true, mode: 0o700 });
file = join(room, `${createHash("sha256").update(session.sessionId).digest("hex")}.json`);
await publish();
session.on((event) => {
  if (applyEvent(state, event)) {
    void publish().catch((error) =>
      session.log(`Agent Inc Live could not publish status: ${error.message}`, { level: "error" }));
  }
});
const heartbeat = setInterval(() => {
  void refreshTitle().then(publish).catch((error) =>
    session.log(`Agent Inc Live heartbeat failed: ${error.message}`, { level: "error" }));
}, 10_000);
process.once("SIGTERM", () => {
  clearInterval(heartbeat);
  void writing.then(() => unlink(file)).catch((error) => {
    if (error.code !== "ENOENT") process.stderr.write(`Agent Inc Live cleanup: ${error.message}\n`);
  }).finally(() => process.exit(0));
});
