import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function shouldRegister(moduleUrl, home = process.env.COPILOT_HOME || join(homedir(), ".copilot")) {
  const current = resolve(fileURLToPath(moduleUrl));
  const userEntry = resolve(home, "extensions", "agentcorp-extension", "extension.mjs");
  const previousEntry = resolve(home, "extensions", "agentcorp-observer-viewer", "extension.mjs");
  if (current === previousEntry) return true;
  for (const entryPath of [previousEntry, userEntry]) {
    if (entryPath === current) continue;
    try {
      const entry = await stat(entryPath);
      if (!entry.isFile()) throw new Error(`Observer user entry is not a file: ${entryPath}`);
      return false;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return true;
}
