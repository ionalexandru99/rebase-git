import type { DesktopUpdates, EnvironmentBootstrap } from "@rebase/contracts";

export type { EnvironmentBootstrap } from "@rebase/contracts";

export interface RepositoryFilesystemHost {
  revealRepository(path: string): Promise<void>;
}

export interface DesktopHostBridge
  extends EnvironmentBootstrap,
    RepositoryFilesystemHost {
  readonly updates: DesktopUpdates;
}

declare global {
  interface Window {
    readonly rebaseHost?: DesktopHostBridge;
  }
}
