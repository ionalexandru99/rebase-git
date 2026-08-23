import type { DesktopUpdateSettings } from "@rebase/contracts";

export interface ApplicationUpdateSettingsStore {
  read(): Promise<DesktopUpdateSettings>;
  write(settings: DesktopUpdateSettings): Promise<void>;
}
