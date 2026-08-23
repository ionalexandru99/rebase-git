import { Schema } from "effect";

export const releaseChannels = ["stable", "nightly"] as const;
export const ReleaseChannel = Schema.Literals(releaseChannels);
export type ReleaseChannel = typeof ReleaseChannel.Type;

export const DesktopUpdateSettings = Schema.Struct({
  checkAutomatically: Schema.Boolean,
  releaseChannel: ReleaseChannel,
});
export type DesktopUpdateSettings = typeof DesktopUpdateSettings.Type;

export type DesktopUpdateStatus =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Checking" }
  | { readonly _tag: "UpToDate" }
  | {
      readonly _tag: "Downloading";
      readonly percent: number;
      readonly version: string;
    }
  | { readonly _tag: "Ready"; readonly version: string }
  | { readonly _tag: "Error"; readonly message: string }
  | { readonly _tag: "Unavailable" };

export interface DesktopUpdateSnapshot {
  readonly settings: DesktopUpdateSettings;
  readonly status: DesktopUpdateStatus;
}

export interface DesktopUpdates {
  checkForUpdates(): Promise<void>;
  getSnapshot(): Promise<DesktopUpdateSnapshot>;
  installUpdate(): Promise<void>;
  selectReleaseChannel(channel: ReleaseChannel): Promise<void>;
  setCheckAutomatically(enabled: boolean): Promise<void>;
  subscribe(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void;
}
