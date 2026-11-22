import { z } from "zod";

export const releaseChannels = ["stable", "nightly"] as const;
export const ReleaseChannel = z.enum(releaseChannels);
export type ReleaseChannel = z.infer<typeof ReleaseChannel>;

export const DesktopUpdateSettings = z.object({
  checkAutomatically: z.boolean(),
  releaseChannel: ReleaseChannel,
});
export type DesktopUpdateSettings = z.infer<typeof DesktopUpdateSettings>;

export const DesktopUpdateStatus = z.discriminatedUnion("_tag", [
  z.object({ _tag: z.literal("Idle") }),
  z.object({ _tag: z.literal("Checking") }),
  z.object({ _tag: z.literal("UpToDate") }),
  z.object({
    _tag: z.literal("Downloading"),
    percent: z.number(),
    version: z.string(),
  }),
  z.object({ _tag: z.literal("Ready"), version: z.string() }),
  z.object({ _tag: z.literal("Error"), message: z.string() }),
  z.object({ _tag: z.literal("Unavailable") }),
]);
export type DesktopUpdateStatus = z.infer<typeof DesktopUpdateStatus>;

export const DesktopUpdateSnapshot = z.object({
  settings: DesktopUpdateSettings,
  status: DesktopUpdateStatus,
});
export type DesktopUpdateSnapshot = z.infer<typeof DesktopUpdateSnapshot>;

export interface DesktopUpdates {
  checkForUpdates(): Promise<void>;
  getSnapshot(): Promise<DesktopUpdateSnapshot>;
  installUpdate(): Promise<void>;
  selectReleaseChannel(channel: ReleaseChannel): Promise<void>;
  setCheckAutomatically(enabled: boolean): Promise<void>;
  subscribe(listener: (snapshot: DesktopUpdateSnapshot) => void): () => void;
}
