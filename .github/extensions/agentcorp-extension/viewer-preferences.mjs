import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { readSettings, settingsPath, validateSettings } from "./auto-open.mjs";

export const motionPath = join(dirname(settingsPath), "viewer-preferences.json");
export function validateMotion(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== 1 || !Object.hasOwn(value, "motion") ||
    !["system", "reduced", "full"].includes(value.motion)) {
    throw new Error('Viewer preferences require only "motion": "system", "reduced", or "full".');
  }
  return { motion: value.motion };
}

export async function readMotion(path = motionPath) {
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { motion: "system" };
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
  if (Object.hasOwn(value, "motion")) return validateMotion(value);
  if (Object.hasOwn(value, "autoOpen")) return validateSettings(value);
  throw new Error("Unknown office preference.");
}

export async function savePreference(value) {
  const update = validatePreferenceUpdate(value);
  const autoOpen = Object.hasOwn(update, "autoOpen");
  // Refuse to overwrite malformed or unreadable existing settings.
  await readPreferences();
  const path = autoOpen ? settingsPath : motionPath;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(update)}\n`, { flag: "wx", mode: 0o600 });
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return readPreferences();
}
