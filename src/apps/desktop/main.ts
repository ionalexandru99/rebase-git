import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import electronUpdater, { type AppUpdater } from "electron-updater";
import {
  type DesktopUpdateSnapshot,
  ReleaseChannel,
} from "#contracts/desktop-updates/desktop-updates.contract.ts";
import {
  type DesktopApplication,
  type DesktopApplicationHost,
  type DesktopRenderer,
  type DesktopWindowOptions,
  startDesktopApplication,
} from "#desktop/app/desktop-application.ts";
import { createApplicationUpdateSettingsStore } from "#desktop/features/application-updates/application-update-settings-store.ts";
import {
  type ApplicationUpdater,
  createApplicationUpdater,
} from "#desktop/features/application-updates/application-updater.ts";
import { registerRepositoryFilesystemIpc } from "#desktop/features/repository-filesystem/repository-filesystem-ipc.ts";
import {
  applicationUpdaterIpc,
  desktopApplicationIpc,
} from "#desktop/ipc-channels.ts";
import { startManagedEnvironmentServer } from "#desktop/platform/environment/environment-supervisor.ts";
import {
  createTrustedIpcHandler,
  isExternalPullRequestLink,
  isTrustedRendererLocation,
  type TrustedIpcHandler,
} from "#desktop/platform/renderer-trust.ts";

let desktopApplication: DesktopApplication | undefined;
const desktopIconPath = fileURLToPath(
  new URL("./assets/icon.png", import.meta.url),
);
const dockIconPath = fileURLToPath(
  new URL("./assets/icon-mac.png", import.meta.url),
);

app.on("activate", () => {
  void desktopApplication?.activate().catch(reportStartupFailure);
});

app.on("before-quit", (event) => {
  void desktopApplication?.beforeQuit(event).catch(reportStartupFailure);
});

app.on("window-all-closed", () => {
  void desktopApplication?.windowAllClosed().catch(reportStartupFailure);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    const shutdown = desktopApplication?.stop() ?? Promise.resolve();
    void shutdown.then(() => app.exit(0), reportStartupFailure);
  });
}

void start().catch(reportStartupFailure);

async function start() {
  await app.whenReady();
  app.dock?.setIcon(dockIconPath);
  const updateSettings = createApplicationUpdateSettingsStore(
    join(app.getPath("userData"), "update-settings.json"),
  );
  const applicationUpdater = createApplicationUpdater(getAutoUpdater(), {
    packaged: app.isPackaged,
    saveSettings: updateSettings.write,
    settings: await updateSettings.read(),
  });
  const renderer = resolveRenderer(
    process.argv,
    import.meta.url,
    app.isPackaged,
  );
  const trusted = createTrustedIpcHandler(renderer);
  registerApplicationUpdaterIpc(applicationUpdater, trusted);
  registerRepositoryFilesystemIpc(trusted);
  desktopApplication = await startDesktopApplication({
    host: createHost(trusted),
    renderer,
    startEnvironment: () =>
      startManagedEnvironmentServer((error) =>
        reportFailure("Rebase stopped", error),
      ),
  });
  void applicationUpdater.start();
}

function getAutoUpdater(): AppUpdater {
  return electronUpdater.autoUpdater;
}

function createHost(trusted: TrustedIpcHandler): DesktopApplicationHost {
  return {
    platform: process.platform,
    hasOpenWindows: () => BrowserWindow.getAllWindows().length > 0,
    openWindow: (options) => openWindow(options, trusted),
    quit: () => app.quit(),
  };
}

async function openWindow(
  options: DesktopWindowOptions,
  trusted: TrustedIpcHandler,
) {
  const window = new BrowserWindow({
    backgroundColor: "#000000",
    height: 800,
    icon: desktopIconPath,
    show: false,
    webPreferences: {
      additionalArguments: [
        `--rebase-environment-origin=${options.environmentOrigin}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      sandbox: true,
    },
    width: 1200,
  });

  registerEnvironmentCredentialIpc(window, options, trusted);
  preventUntrustedNavigation(window, options.renderer);
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalPullRequestLink(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.once("ready-to-show", () => window.show());

  try {
    if (options.renderer.type === "url") {
      await window.loadURL(options.renderer.url);
    } else {
      await window.loadFile(options.renderer.path);
    }
  } catch (error) {
    window.destroy();
    throw error;
  }
}

function registerEnvironmentCredentialIpc(
  window: BrowserWindow,
  options: DesktopWindowOptions,
  trusted: TrustedIpcHandler,
) {
  window.webContents.ipc.handle(
    desktopApplicationIpc.getEnvironmentCredential,
    trusted(() => options.credential),
  );
}

function preventUntrustedNavigation(
  window: BrowserWindow,
  renderer: DesktopRenderer,
) {
  const guardNavigation = (event: Electron.Event, target: string) => {
    if (!isTrustedRendererLocation(renderer, target)) event.preventDefault();
  };
  window.webContents.on("will-navigate", guardNavigation);
  window.webContents.on("will-redirect", guardNavigation);
}

function resolveRenderer(
  arguments_: readonly string[],
  moduleUrl: string,
  packaged: boolean,
): DesktopRenderer {
  const rendererUrl = arguments_
    .find((argument) => argument.startsWith("--renderer-url="))
    ?.slice("--renderer-url=".length);

  if (rendererUrl !== undefined && !packaged) {
    return { type: "url", url: new URL(rendererUrl).href };
  }

  return {
    type: "file",
    path: fileURLToPath(new URL("./web/index.html", moduleUrl)),
  };
}

function reportStartupFailure(error: unknown) {
  reportFailure("Rebase could not start", error);
}

function reportFailure(title: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
  dialog.showErrorBox(title, message);
  app.quit();
}

function registerApplicationUpdaterIpc(
  updater: ApplicationUpdater,
  trusted: TrustedIpcHandler,
) {
  ipcMain.handle(
    applicationUpdaterIpc.snapshot,
    trusted(() => updater.getSnapshot()),
  );
  ipcMain.handle(
    applicationUpdaterIpc.check,
    trusted(() => updater.checkForUpdates()),
  );
  ipcMain.handle(
    applicationUpdaterIpc.install,
    trusted(() => updater.installUpdate()),
  );
  ipcMain.handle(
    applicationUpdaterIpc.selectReleaseChannel,
    trusted((_event, value: unknown) =>
      updater.selectReleaseChannel(
        Schema.decodeUnknownSync(ReleaseChannel)(value),
      ),
    ),
  );
  ipcMain.handle(
    applicationUpdaterIpc.setCheckAutomatically,
    trusted((_event, value: unknown) => {
      if (typeof value !== "boolean") {
        throw new TypeError("checkAutomatically must be a boolean.");
      }
      return updater.setCheckAutomatically(value);
    }),
  );

  return updater.subscribe(sendSnapshot);
}

function sendSnapshot(snapshot: DesktopUpdateSnapshot) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(applicationUpdaterIpc.snapshotChanged, snapshot);
  }
}
