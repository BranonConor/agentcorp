export const MAX_DESKS: number;
export const MAX_PRESENCE_IDS: number;
export const EXPIRY_MS: number;
export const dataDir: string;
export function validId(id: unknown): string;
export function validPresenceIds(ids: unknown): string[];
export function heartbeat(id: string, phase: "idle" | "thinking" | "tool" | "blocked" | "offline", owner: string, now?: number): Promise<void>;
export function clearHeartbeat(id: string, owner: string): Promise<void>;
export function snapshot(root: string, now?: number, presenceIds?: readonly string[]): Promise<{
  root: string;
  sessions: { id: string; phase: "idle" | "thinking" | "tool" | "blocked"; present: true }[];
  overflow: number;
  presence?: Record<string, boolean>;
}>;
