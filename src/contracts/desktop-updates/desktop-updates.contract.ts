import { Schema } from "effect";

export const releaseChannels = ["stable", "nightly"] as const;
export const ReleaseChannel = Schema.Literals(releaseChannels);
export type ReleaseChannel = typeof ReleaseChannel.Type;

export const DesktopUpdateSettings = Schema.Struct({
  checkAutomatically: Schema.Boolean,
  releaseChannel: ReleaseChannel,
});
export type DesktopUpdateSettings = typeof DesktopUpdateSettings.Type;

export const DesktopUpdateStatus = Schema.Union([
  Schema.TaggedStruct("Idle", {}),
  Schema.TaggedStruct("Checking", {}),
  Schema.TaggedStruct("UpToDate", {}),
  Schema.TaggedStruct("Downloading", {
    percent: Schema.Number,
    version: Schema.String,
  }),
  Schema.TaggedStruct("Ready", { version: Schema.String }),
  Schema.TaggedStruct("Error", { message: Schema.String }),
  Schema.TaggedStruct("Unavailable", {}),
]);
export type DesktopUpdateStatus = typeof DesktopUpdateStatus.Type;

export const DesktopUpdateSnapshot = Schema.Struct({
  settings: DesktopUpdateSettings,
  status: DesktopUpdateStatus,
});
export type DesktopUpdateSnapshot = typeof DesktopUpdateSnapshot.Type;

export interface DesktopUpdates {
  checkForUpdates(): Promise<void>;
  getSnapshot(): Promise<DesktopUpdateSnapshot>;
  installUpdate(): Promise<void>;
  selectReleaseChannel(channel: ReleaseChannel): Promise<void>;
  setCheckAutomatically(enabled: boolean): Promise<void>;
  subscribe(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void;
}
