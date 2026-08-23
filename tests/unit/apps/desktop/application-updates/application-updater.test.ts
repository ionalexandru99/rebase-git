import {
  createApplicationUpdater,
  type DesktopAutoUpdater,
} from "@rebase/desktop";
import { describe, expect, it, vi } from "vite-plus/test";

describe("desktop application updater", () => {
  it("keeps automatic checks disabled until the user enables them", async () => {
    const updater = createTestUpdater();
    const saveSettings = vi.fn(() => Promise.resolve());
    const applicationUpdater = createApplicationUpdater(updater, {
      packaged: true,
      saveSettings,
      settings: {
        checkAutomatically: false,
        releaseChannel: "stable",
      },
    });

    await applicationUpdater.start();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();

    await applicationUpdater.selectReleaseChannel("nightly");
    expect(applicationUpdater.getSnapshot().settings).toEqual({
      checkAutomatically: false,
      releaseChannel: "nightly",
    });
    expect(updater).toMatchObject({
      allowDowngrade: false,
      allowPrerelease: true,
      autoDownload: true,
      autoInstallOnAppQuit: false,
      channel: "nightly",
    });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();

    await applicationUpdater.setCheckAutomatically(true);
    expect(saveSettings).toHaveBeenLastCalledWith({
      checkAutomatically: true,
      releaseChannel: "nightly",
    });
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  });

  it("publishes download state and installs a ready update", async () => {
    const updater = createTestUpdater();
    const applicationUpdater = createApplicationUpdater(updater, {
      packaged: true,
      saveSettings: () => Promise.resolve(),
      settings: {
        checkAutomatically: true,
        releaseChannel: "stable",
      },
    });

    await applicationUpdater.checkForUpdates();
    expect(applicationUpdater.getSnapshot().status).toEqual({
      _tag: "Checking",
    });

    updater.emit("update-available", { version: "0.0.3" });
    updater.emit("download-progress", { percent: 41.4 });
    expect(applicationUpdater.getSnapshot().status).toEqual({
      _tag: "Downloading",
      percent: 41,
      version: "0.0.3",
    });

    updater.emit("update-downloaded", { version: "0.0.3" });
    expect(applicationUpdater.getSnapshot().status).toEqual({
      _tag: "Ready",
      version: "0.0.3",
    });
    await expect(
      applicationUpdater.selectReleaseChannel("nightly"),
    ).rejects.toThrow("cannot change while an update is active");
    expect(applicationUpdater.getSnapshot().settings.releaseChannel).toBe(
      "stable",
    );

    applicationUpdater.installUpdate();
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("does not contact the update feed from an unpackaged build", async () => {
    const updater = createTestUpdater();
    const applicationUpdater = createApplicationUpdater(updater, {
      packaged: false,
      saveSettings: () => Promise.resolve(),
      settings: {
        checkAutomatically: true,
        releaseChannel: "nightly",
      },
    });

    await applicationUpdater.start();
    await applicationUpdater.checkForUpdates();

    expect(updater.channel).toBe("nightly");
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(applicationUpdater.getSnapshot().status).toEqual({
      _tag: "Unavailable",
    });
  });

  it("marks a packaged build unavailable when its platform updater is inactive", async () => {
    const updater = createTestUpdater();
    updater.checkForUpdates.mockResolvedValueOnce(null);
    const applicationUpdater = createApplicationUpdater(updater, {
      packaged: true,
      saveSettings: () => Promise.resolve(),
      settings: {
        checkAutomatically: false,
        releaseChannel: "stable",
      },
    });

    await applicationUpdater.checkForUpdates();

    expect(applicationUpdater.getSnapshot().status).toEqual({
      _tag: "Unavailable",
    });
  });

  it("serializes settings changes against the latest saved snapshot", async () => {
    const updater = createTestUpdater();
    const savedSettings: Array<{
      checkAutomatically: boolean;
      releaseChannel: "nightly" | "stable";
    }> = [];
    const applicationUpdater = createApplicationUpdater(updater, {
      packaged: true,
      saveSettings: async (settings) => {
        await Promise.resolve();
        savedSettings.push(settings);
      },
      settings: {
        checkAutomatically: false,
        releaseChannel: "stable",
      },
    });

    await Promise.all([
      applicationUpdater.selectReleaseChannel("nightly"),
      applicationUpdater.setCheckAutomatically(true),
    ]);

    expect(savedSettings).toEqual([
      { checkAutomatically: false, releaseChannel: "nightly" },
      { checkAutomatically: true, releaseChannel: "nightly" },
    ]);
    expect(applicationUpdater.getSnapshot().settings).toEqual({
      checkAutomatically: true,
      releaseChannel: "nightly",
    });
  });

  it("locks the channel after an update check starts", async () => {
    const updater = createTestUpdater();
    const applicationUpdater = createApplicationUpdater(updater, {
      packaged: true,
      saveSettings: () => Promise.resolve(),
      settings: {
        checkAutomatically: false,
        releaseChannel: "stable",
      },
    });

    await applicationUpdater.checkForUpdates();

    await expect(
      applicationUpdater.selectReleaseChannel("nightly"),
    ).rejects.toThrow("cannot change while an update is active");
    updater.emit("update-downloaded", { version: "0.0.3" });
    expect(applicationUpdater.getSnapshot().status).toEqual({
      _tag: "Checking",
    });
  });
});

function createTestUpdater() {
  const listeners = new Map<string, Array<(value?: unknown) => void>>();
  return {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    channel: null,
    checkForUpdates: vi.fn((): Promise<unknown> => Promise.resolve()),
    emit(event: string, value?: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(value);
    },
    on(event: string, listener: (value?: unknown) => void) {
      const eventListeners = listeners.get(event) ?? [];
      eventListeners.push(listener);
      listeners.set(event, eventListeners);
      return this;
    },
    quitAndInstall: vi.fn(),
  } satisfies DesktopAutoUpdater & {
    emit(event: string, value?: unknown): void;
  };
}
