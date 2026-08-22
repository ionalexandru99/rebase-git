import type { EnvironmentBootstrap } from "@rebase/contracts";

export type { EnvironmentBootstrap } from "@rebase/contracts";

declare global {
  interface Window {
    readonly rebaseHost?: EnvironmentBootstrap;
  }
}
