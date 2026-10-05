import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { validId } from "./observations.mjs";

const settingsPath = join(
  process.env.COPILOT_HOME || join(homedir(), ".copilot"),
  "extensions", "agentcorp-extension", "artifacts", "settings.json",
);

export async function readSettings(path = settingsPath) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { autoOpen: false };
    throw new Error(`Cannot read AgentCorp settings at ${path}.`, { cause: error });
  }
  let settings;
  try {
    settings = JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON in AgentCorp settings at ${path}.`, { cause: error });
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings) ||
    Object.keys(settings).some(key => key !== "autoOpen") ||
    (Object.hasOwn(settings, "autoOpen") && typeof settings.autoOpen !== "boolean")) {
    throw new Error(`AgentCorp settings at ${path} must be an object with an optional boolean "autoOpen".`);
  }
  return { autoOpen: settings.autoOpen ?? false };
}

export async function autoOpenCanvas(session, path = settingsPath) {
  if (!session.capabilities.ui?.canvases) return "unsupported";
  if (!(await readSettings(path)).autoOpen) return "disabled";
  if (!session.workspacePath) {
    throw new Error("AgentCorp auto-open requires a session workspace to remember closed panels.");
  }

  const directory = join(session.workspacePath, "files");
  const marker = join(directory, `agentcorp-auto-open-${validId(session.sessionId)}.json`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    // Claim once per session, including across extension reloads and app restarts.
    await writeFile(marker, '{"version":1}\n', { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code === "EEXIST") return "already-handled";
    throw error;
  }

  try {
    const { openCanvases } = await session.rpc.canvas.listOpen();
    if (openCanvases.some(canvas => canvas.canvasId === "agentcorp-observer")) {
      return "already-open";
    }
    await session.rpc.canvas.open({
      canvasId: "agentcorp-observer",
      instanceId: "office-startup",
    });
    return "opened";
  } catch (error) {
    // A failed RPC can be retried on the next extension startup.
    await rm(marker, { force: true });
    throw error;
  }
}
