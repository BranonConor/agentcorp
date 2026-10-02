export type MotionPreference = "system" | "reduced" | "full";
export type ViewerPreferences = { motion: MotionPreference; autoOpen: boolean };

export function reducedMotion(preference: MotionPreference, systemReduced: boolean): boolean {
  return preference === "reduced" || (preference === "system" && systemReduced);
}

export function parsePreferences(value: unknown): ViewerPreferences {
  if (!value || typeof value !== "object" || !("motion" in value) ||
    !("autoOpen" in value) || typeof value.autoOpen !== "boolean" ||
    (value.motion !== "system" && value.motion !== "reduced" && value.motion !== "full")) {
    throw new Error("Invalid saved office preferences.");
  }
  return { motion: value.motion, autoOpen: value.autoOpen };
}
