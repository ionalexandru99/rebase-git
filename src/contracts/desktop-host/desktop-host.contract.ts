import type { DesktopUpdates } from "#contracts/desktop-updates/desktop-updates.contract.ts";

export interface RepositoryFilesystemHost {
  revealRepository(path: string): Promise<void>;
}

export interface DesktopHostBridge extends RepositoryFilesystemHost {
  readonly environmentOrigin: string;
  getEnvironmentCredential(): Promise<string>;
  readonly updates: DesktopUpdates;
}
