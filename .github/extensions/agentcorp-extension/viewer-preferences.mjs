import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { readSettings, settingsPath, validateSettings } from "./auto-open.mjs";
import { claimPreferenceLock } from "./preference-lock.mjs";

export const motionPath = join(dirname(settingsPath), "viewer-preferences.json");
export function validateMotion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).some(key => !["motion", "theme", "chatBubbles"].includes(key)) ||
    !["system", "reduced", "full"].includes(value.motion) ||
    (Object.hasOwn(value, "theme") && !["system", "light", "dark"].includes(value.theme)) ||
    (Object.hasOwn(value, "chatBubbles") && typeof value.chatBubbles !== "boolean")) {
    throw new Error("Invalid viewer motion, theme, or chatBubbles preference.");
  }
  return { motion: value.motion, chatBubbles: value.chatBubbles ?? true,
    ...(Object.hasOwn(value, "theme") ? { theme: value.theme } : {}) };
}

export async function readMotion(path = motionPath) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { motion: "system", chatBubbles: true };
    throw error;
  }
  return validateMotion(JSON.parse(text));
}

export async function readPreferences() {
  return { ...await readSettings(), ...await readMotion() };
}

export function validatePreferenceUpdate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1) {
    throw new Error("Change exactly one office preference.");
  }
  if (Object.hasOwn(value, "autoOpen")) return validateSettings(value);
  const [key] = Object.keys(value);
  if (key === "motion" || key === "theme" || key === "chatBubbles") {
    validateMotion({ motion: "system", ...value });
    return value;
  }
  throw new Error("Unknown office preference.");
}

export async function savePreference(value) {
  const update = validatePreferenceUpdate(value);
  const autoOpen = Object.hasOwn(update, "autoOpen");
  const path = autoOpen ? settingsPath : motionPath;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const release = await claimPreferenceLock(dirname(path));
  try {
    // Read-modify-write under a cross-process lock so independent canvas providers cannot lose fields.
    await readPreferences();
    const settings = autoOpen ? update : { ...await readMotion(), ...update };
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(settings)}\n`, { flag: "wx", mode: 0o600 });
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return await readPreferences();
  } finally {
    await release();
  }
}
