export type MotionPreference = "system" | "reduced" | "full";
export type ThemePreference = "system" | "light" | "dark";
export type ViewerPreferences = { motion: MotionPreference; autoOpen: boolean; chatBubbles: boolean; theme?: ThemePreference };
export type PreferenceUpdate = { motion: MotionPreference } | { autoOpen: boolean } | { chatBubbles: boolean } | { theme: ThemePreference };

export function reducedMotion(preference: MotionPreference, systemReduced: boolean): boolean {
  return preference === "reduced" || (preference === "system" && systemReduced);
}

export function parsePreferences(value: unknown): ViewerPreferences {
  if (!value || typeof value !== "object" || !("motion" in value) ||
    !("autoOpen" in value) || typeof value.autoOpen !== "boolean" ||
    (value.motion !== "system" && value.motion !== "reduced" && value.motion !== "full") ||
    ("chatBubbles" in value && typeof value.chatBubbles !== "boolean") ||
    ("theme" in value && value.theme !== "system" && value.theme !== "light" && value.theme !== "dark")) {
    throw new Error("Invalid saved office preferences.");
  }
  const theme = "theme" in value ? value.theme : undefined;
  return { motion: value.motion, autoOpen: value.autoOpen,
    chatBubbles: "chatBubbles" in value ? value.chatBubbles === true : true,
    ...(theme === "system" || theme === "light" || theme === "dark" ? { theme } : {}) };
}
