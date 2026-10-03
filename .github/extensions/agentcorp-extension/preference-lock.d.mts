export function preferenceLockPort(directory: string): Promise<number>;
export function claimPreferenceLock(directory: string): Promise<() => Promise<void>>;
