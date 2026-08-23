import type { DesktopUpdates, EnvironmentBootstrap } from "@rebase/contracts";

export interface DesktopHostBridge extends EnvironmentBootstrap {
  readonly updates: DesktopUpdates;
}
