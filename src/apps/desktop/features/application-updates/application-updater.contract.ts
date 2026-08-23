import type {
  DesktopUpdateSettings,
  DesktopUpdateSnapshot,
  ReleaseChannel,
} from "@rebase/contracts";

export type DesktopUpdaterEvent =
  | "checking-for-update"
  | "update-available"
  | "update-not-available"
  | "download-progress"
  | "update-downloaded"
  | "error";

export interface DesktopAutoUpdater {
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  channel: string | null;
  checkForUpdates(): Promise<unknown>;
  on(event: DesktopUpdaterEvent, listener: (value?: unknown) => void): unknown;
  quitAndInstall(): void;
}

export interface ApplicationUpdaterOptions {
  readonly packaged: boolean;
  readonly saveSettings: (settings: DesktopUpdateSettings) => Promise<void>;
  readonly settings: DesktopUpdateSettings;
}

export interface ApplicationUpdater {
  checkForUpdates(): Promise<void>;
  getSnapshot(): DesktopUpdateSnapshot;
  installUpdate(): void;
  selectReleaseChannel(channel: ReleaseChannel): Promise<void>;
  setCheckAutomatically(enabled: boolean): Promise<void>;
  start(): Promise<void>;
  subscribe(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void;
}
