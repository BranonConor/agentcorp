export interface AutoOpenSession {
  sessionId: string;
  workspacePath?: string;
  capabilities: { ui?: { canvases?: boolean } };
  rpc: {
    canvas: {
      listOpen(): Promise<{ openCanvases: { canvasId: string }[] }>;
      open(input: { canvasId: string; instanceId: string }): Promise<unknown>;
    };
  };
}

export function readSettings(path?: string): Promise<{ autoOpen: boolean }>;
export const settingsPath: string;
export function validateSettings(settings: unknown): { autoOpen: boolean };
export function autoOpenCanvas(session: AutoOpenSession, path?: string): Promise<
  "unsupported" | "disabled" | "already-handled" | "already-open" | "opened"
>;
