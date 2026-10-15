import { describe, expect, it, vi } from "vite-plus/test";
import {
  createApplicationUpdater,
  type DesktopAutoUpdater,
  updatesItself,
} from "#desktop/features/application-updates/application-updater.ts";

describe("desktop application install ownership", () => {
  const ownAppImage = {
    appImage: "/home/alex/AppImages/rebase.appimage",
    appImageMount: "/tmp/.mount_RebaseQx",
  };
  const otherAppImage = {
    appImage: "/home/alex/AppImages/t3_code.appimage",
    appImageMount: "/tmp/.mount_t3_codXy",
  };
  const noAppImage = { appImage: undefined, appImageMount: undefined };

  it.each([
    {
      name: "a development build",
      packaged: false,
      platform: "darwin",
      executable: "/Rebase/electron",
      ...noAppImage,
      expected: false,
    },
    {
      name: "macOS",
      packaged: true,
      platform: "darwin",
      executable: "/Applications/Rebase.app",
      ...noAppImage,
      expected: true,
    },
    {
      name: "Windows",
      packaged: true,
      platform: "win32",
      executable: "C:\\Rebase\\Rebase.exe",
      ...noAppImage,
      expected: true,
    },
    {
      name: "its own AppImage",
      packaged: true,
      platform: "linux",
      executable: "/tmp/.mount_RebaseQx/rebase",
      ...ownAppImage,
      expected: true,
    },
    {
      name: "a package manager install",
      packaged: true,
      platform: "linux",
      executable: "/opt/Rebase/rebase",
      ...noAppImage,
      expected: false,
    },
    {
      name: "a package manager install started from another AppImage",
      packaged: true,
      platform: "linux",
      executable: "/opt/Rebase/rebase",
      ...otherAppImage,
      expected: false,
    },
  ] as const)(
    "decides whether $name updates itself",
    ({ name: _name, expected, ...install }) => {
      expect(updatesItself(install)).toBe(expected);
    },
  );
});

describe("desktop application updater", () => {
  it("keeps automatic checks disabled until the user enables them", async () => {
    const updater = createTestUpdater();
    const saveSettings = vi.fn(() => Promise.resolve());
    const applicationUpdater = createApplicationUpdater(updater, {
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

  it("moves back to stable releases from 0.0.5 on", async () => {
    const updater = createTestUpdater();
    const applicationUpdater = createApplicationUpdater(updater, {
      saveSettings: () => Promise.resolve(),
      settings: {
        checkAutomatically: false,
        releaseChannel: "nightly",
      },
    });

    await applicationUpdater.selectReleaseChannel("stable");

    expect(updater.allowDowngrade).toBe(true);
    expect(await updater.isUpdateSupported({ version: "0.0.4" })).toBe(false);
    expect(await updater.isUpdateSupported({ version: "0.0.5" })).toBe(true);
    expect(
      await updater.isUpdateSupported({
        version: "0.0.5-nightly.20261005.147",
      }),
    ).toBe(true);
  });

  it("publishes download state and installs a ready update", async () => {
    const updater = createTestUpdater();
    const applicationUpdater = createApplicationUpdater(updater, {
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

  it("marks updates unavailable when its platform updater is inactive", async () => {
    const updater = createTestUpdater();
    updater.checkForUpdates.mockResolvedValueOnce(null);
    const applicationUpdater = createApplicationUpdater(updater, {
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

  it("queues update checks behind release channel writes", async () => {
    const updater = createTestUpdater();
    const settingsWrite = Promise.withResolvers<void>();
    const saveStarted = Promise.withResolvers<void>();
    const applicationUpdater = createApplicationUpdater(updater, {
      saveSettings: async () => {
        saveStarted.resolve();
        await settingsWrite.promise;
      },
      settings: {
        checkAutomatically: false,
        releaseChannel: "stable",
      },
    });

    const channelChange = applicationUpdater.selectReleaseChannel("nightly");
    await saveStarted.promise;
    const updateCheck = applicationUpdater.checkForUpdates();
    expect(updater.checkForUpdates).not.toHaveBeenCalled();

    settingsWrite.resolve();
    await Promise.all([channelChange, updateCheck]);

    expect(updater.channel).toBe("nightly");
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  });
});

function createTestUpdater() {
  const listeners = new Map<string, Array<(value?: unknown) => void>>();
  let allowDowngrade = false;
  let channel: string | null = null;
  return {
    get allowDowngrade() {
      return allowDowngrade;
    },
    set allowDowngrade(value) {
      allowDowngrade = value;
    },
    allowPrerelease: false,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    get channel() {
      return channel;
    },
    set channel(value) {
      channel = value;
      allowDowngrade = true;
    },
    checkForUpdates: vi.fn((): Promise<unknown> => Promise.resolve()),
    isUpdateSupported: (_info: {
      readonly version: string;
    }): boolean | Promise<boolean> => true,
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
