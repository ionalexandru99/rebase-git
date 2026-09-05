import type { DesktopHostBridge } from "@rebase/contracts";

export type {
  DesktopHostBridge,
  RepositoryFilesystemHost,
} from "@rebase/contracts";

declare global {
  interface Window {
    readonly rebaseHost?: DesktopHostBridge;
  }
}
