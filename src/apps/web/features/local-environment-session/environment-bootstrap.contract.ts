import type { DesktopHostBridge } from "@rebase/contracts";

export type {
  DesktopHostBridge,
  EnvironmentBootstrap,
  RepositoryFilesystemHost,
} from "@rebase/contracts";

declare global {
  interface Window {
    readonly rebaseHost?: DesktopHostBridge;
  }
}
