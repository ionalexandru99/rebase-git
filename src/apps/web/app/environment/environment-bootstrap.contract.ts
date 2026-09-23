import type { DesktopHostBridge } from "@rebase/contracts";

export type {
  DesktopHostBridge,
  RepositoryFilesystemHost,
} from "@rebase/contracts";

export type DesktopEnvironmentHost = Pick<
  DesktopHostBridge,
  "environmentOrigin" | "getEnvironmentCredential"
>;

declare global {
  interface Window {
    readonly rebaseHost?: DesktopHostBridge;
  }
}
