import type { DesktopUpdates, EnvironmentBootstrap } from "@rebase/contracts";

export type { EnvironmentBootstrap } from "@rebase/contracts";

export interface DesktopHostBridge extends EnvironmentBootstrap {
  readonly updates: DesktopUpdates;
}

declare global {
  interface Window {
    readonly rebaseHost?: DesktopHostBridge;
  }
}
