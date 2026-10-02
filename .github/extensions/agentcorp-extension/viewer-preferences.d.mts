export type MotionPreference = "system" | "reduced" | "full";
export type ViewerPreferences = { motion: MotionPreference; autoOpen: boolean };
export const motionPath: string;
export function validateMotion(value: unknown): { motion: MotionPreference };
export function readMotion(path?: string): Promise<{ motion: MotionPreference }>;
export function readPreferences(): Promise<ViewerPreferences>;
export function validatePreferenceUpdate(value: unknown): { motion: MotionPreference } | { autoOpen: boolean };
export function savePreference(value: unknown): Promise<ViewerPreferences>;
