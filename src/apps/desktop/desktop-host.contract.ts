import type { DesktopUpdates, EnvironmentBootstrap } from "@rebase/contracts";

export interface DesktopHostBridge extends EnvironmentBootstrap {
  revealRepository(path: string): Promise<void>;
  readonly updates: DesktopUpdates;
}
