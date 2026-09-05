import type { DesktopUpdates } from "@rebase/contracts/desktop-updates/desktop-updates.contract";

export interface RepositoryFilesystemHost {
  revealRepository(path: string): Promise<void>;
}

export interface DesktopHostBridge extends RepositoryFilesystemHost {
  readonly environmentOrigin: string;
  getEnvironmentCredential(): Promise<string>;
  readonly updates: DesktopUpdates;
}
