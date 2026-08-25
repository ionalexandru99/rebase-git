import type { DesktopUpdates } from "@rebase/contracts/desktop-updates/desktop-updates.contract";
import type { EnvironmentBootstrap } from "@rebase/contracts/environment-authorization/environment-bootstrap.contract";

export interface RepositoryFilesystemHost {
  revealRepository(path: string): Promise<void>;
}

export interface DesktopHostBridge
  extends EnvironmentBootstrap,
    RepositoryFilesystemHost {
  readonly updates: DesktopUpdates;
}
