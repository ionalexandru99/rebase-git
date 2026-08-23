import type {
  DesktopUpdateSettings,
  DesktopUpdateSnapshot,
  DesktopUpdateStatus,
  ReleaseChannel,
} from "@rebase/contracts";
import type {
  ApplicationUpdater,
  ApplicationUpdaterOptions,
  DesktopAutoUpdater,
} from "#desktop/features/application-updates/application-updater.contract";

export function createApplicationUpdater(
  updater: DesktopAutoUpdater,
  options: ApplicationUpdaterOptions,
): ApplicationUpdater {
  let snapshot: DesktopUpdateSnapshot = {
    settings: options.settings,
    status: options.packaged ? { _tag: "Idle" } : { _tag: "Unavailable" },
  };
  let downloadingVersion: string | undefined;
  let settingsQueue = Promise.resolve();
  const listeners = new Set<(snapshot: DesktopUpdateSnapshot) => void>();

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  updater.allowDowngrade = false;
  configureReleaseChannel(updater, snapshot.settings.releaseChannel);

  const publish = (next: DesktopUpdateSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };
  const publishStatus = (status: DesktopUpdateStatus) =>
    publish({ ...snapshot, status });

  updater.on("checking-for-update", () => {
    if (snapshot.status._tag === "Checking") {
      publishStatus({ _tag: "Checking" });
    }
  });
  updater.on("update-available", (value) => {
    if (snapshot.status._tag !== "Checking") return;
    downloadingVersion = readVersion(value);
    publishStatus({
      _tag: "Downloading",
      percent: 0,
      version: downloadingVersion,
    });
  });
  updater.on("download-progress", (value) => {
    if (snapshot.status._tag !== "Downloading") return;
    publishStatus({
      _tag: "Downloading",
      percent: readPercent(value),
      version: downloadingVersion ?? "New version",
    });
  });
  updater.on("update-downloaded", (value) => {
    if (snapshot.status._tag !== "Downloading") return;
    publishStatus({ _tag: "Ready", version: readVersion(value) });
  });
  updater.on("update-not-available", () => {
    if (snapshot.status._tag === "Checking") {
      publishStatus({ _tag: "UpToDate" });
    }
  });
  updater.on("error", (value) => {
    if (isUpdateActive(snapshot.status)) {
      publishStatus({ _tag: "Error", message: errorMessage(value) });
    }
  });

  const checkForUpdates = async () => {
    if (!options.packaged) {
      publishStatus({ _tag: "Unavailable" });
      return;
    }
    if (isUpdateActive(snapshot.status) || snapshot.status._tag === "Ready") {
      return;
    }

    publishStatus({ _tag: "Checking" });
    try {
      const result = await updater.checkForUpdates();
      if (result === null && isChecking(snapshot.status)) {
        publishStatus({ _tag: "Unavailable" });
      }
    } catch (error) {
      publishStatus({ _tag: "Error", message: errorMessage(error) });
    }
  };

  const updateSettings = <Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    const result = settingsQueue.then(operation, operation);
    settingsQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const saveSettings = async (settings: DesktopUpdateSettings) => {
    try {
      await options.saveSettings(settings);
      publish({ ...snapshot, settings });
    } catch (error) {
      publishStatus({ _tag: "Error", message: errorMessage(error) });
      throw error;
    }
  };

  return {
    checkForUpdates,
    getSnapshot: () => snapshot,
    installUpdate: () => {
      if (snapshot.status._tag !== "Ready") return;
      try {
        updater.quitAndInstall();
      } catch (error) {
        publishStatus({ _tag: "Error", message: errorMessage(error) });
        throw error;
      }
    },
    selectReleaseChannel: (releaseChannel) =>
      updateSettings(async () => {
        if (releaseChannel === snapshot.settings.releaseChannel) return;
        if (
          isUpdateActive(snapshot.status) ||
          snapshot.status._tag === "Ready"
        ) {
          throw new Error(
            "The release channel cannot change while an update is active.",
          );
        }
        const settings = { ...snapshot.settings, releaseChannel };
        await saveSettings(settings);
        configureReleaseChannel(updater, releaseChannel);
        publishStatus(
          options.packaged ? { _tag: "Idle" } : { _tag: "Unavailable" },
        );
        if (settings.checkAutomatically) void checkForUpdates();
      }),
    setCheckAutomatically: (checkAutomatically) =>
      updateSettings(async () => {
        if (checkAutomatically === snapshot.settings.checkAutomatically) return;
        await saveSettings({ ...snapshot.settings, checkAutomatically });
        if (checkAutomatically) void checkForUpdates();
      }),
    start: async () => {
      if (snapshot.settings.checkAutomatically) await checkForUpdates();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function isUpdateActive(status: DesktopUpdateStatus) {
  return status._tag === "Checking" || status._tag === "Downloading";
}

function isChecking(status: DesktopUpdateStatus) {
  return status._tag === "Checking";
}

function configureReleaseChannel(
  updater: DesktopAutoUpdater,
  channel: ReleaseChannel,
) {
  updater.channel = channel === "stable" ? "latest" : "nightly";
  updater.allowPrerelease = channel === "nightly";
}

function readVersion(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "version" in value &&
    typeof value.version === "string"
  ) {
    return value.version;
  }
  return "New version";
}

function readPercent(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "percent" in value &&
    typeof value.percent === "number"
  ) {
    return Math.round(value.percent);
  }
  return 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
