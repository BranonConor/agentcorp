import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const MAX_DESKS = 16;
export const EXPIRY_MS = 45_000;
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const priority = { blocked: 0, tool: 1, thinking: 2, idle: 3 };
const phases = new Set([...Object.keys(priority), "offline"]);
const heartbeatPrefix = "heartbeat-";
const heartbeatSuffix = ".json";
const home = process.env.COPILOT_HOME || join(homedir(), ".copilot");
export const dataDir = join(home, "agentcorp-observer", "artifacts");

export function validId(id) {
  if (typeof id !== "string" || !idPattern.test(id)) throw new Error("Invalid session ID.");
  return id;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function save(path, value) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

const heartbeatPath = id => join(dataDir, `${heartbeatPrefix}${validId(id)}${heartbeatSuffix}`);

export async function heartbeat(id, phase, owner, now = Date.now()) {
  validId(id);
  if (!phases.has(phase)) throw new Error("Invalid phase.");
  if (typeof owner !== "string" || !owner) throw new Error("Invalid heartbeat owner.");
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Invalid heartbeat time.");
  await save(heartbeatPath(id), { id, phase, owner, at: now });
}

export async function clearHeartbeat(id, owner) {
  const path = heartbeatPath(id);
  const entry = await readJson(path);
  if (entry?.owner !== owner) return;
  await rm(path, { force: true });
}

export async function snapshot(root, now = Date.now()) {
  validId(root);
  let files;
  try {
    files = await readdir(dataDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    files = [];
  }
  const sessions = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.startsWith(heartbeatPrefix) || !file.name.endsWith(heartbeatSuffix)) continue;
    const id = file.name.slice(heartbeatPrefix.length, -heartbeatSuffix.length);
    if (!idPattern.test(id)) continue;
    let entry;
    try {
      entry = await readJson(join(dataDir, file.name));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      console.error(`AgentCorp skipped malformed heartbeat ${file.name}.`);
      continue;
    }
    if (entry === undefined || entry?.phase === "offline") continue;
    if (!entry || entry.id !== id || typeof entry.owner !== "string" || !entry.owner ||
      typeof entry.phase !== "string" || !Object.hasOwn(priority, entry.phase) ||
      !Number.isSafeInteger(entry.at) || entry.at < 0) {
      console.error(`AgentCorp skipped invalid heartbeat ${file.name}.`);
      continue;
    }
    if (entry.at > now || now - entry.at > EXPIRY_MS) continue;
    sessions.push({ id, phase: entry.phase, present: true });
  }
  sessions.sort((a, b) => priority[a.phase] - priority[b.phase] ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { root, sessions: sessions.slice(0, MAX_DESKS), overflow: Math.max(0, sessions.length - MAX_DESKS) };
}
