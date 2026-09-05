import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog } from "electron";
import electronUpdater, { type AppUpdater } from "electron-updater";
import { createApplicationUpdateSettingsStore } from "#desktop/features/application-updates/application-update-settings-store";
import { createApplicationUpdater } from "#desktop/features/application-updates/application-updater";
import { registerApplicationUpdaterIpc } from "#desktop/features/application-updates/application-updater-ipc";
import {
  type DesktopApplication,
  startDesktopApplication,
} from "#desktop/features/desktop-application/desktop-application";
import type {
  DesktopApplicationHost,
  DesktopRenderer,
  DesktopWindowOptions,
} from "#desktop/features/desktop-application/desktop-application.contract";
import { desktopApplicationIpc } from "#desktop/features/desktop-application/desktop-application-ipc.contract";
import { startManagedEnvironmentServer } from "#desktop/features/environment-supervision/environment-supervisor";
import { createElectronRepositoryFilesystem } from "#desktop/features/repository-filesystem/electron-repository-filesystem";
import { registerRepositoryFilesystemIpc } from "#desktop/features/repository-filesystem/repository-filesystem-ipc";

let desktopApplication: DesktopApplication | undefined;
const desktopIconPath = fileURLToPath(
  new URL("./assets/icon.png", import.meta.url),
);

const host: DesktopApplicationHost = {
  platform: process.platform,
  hasOpenWindows: () => BrowserWindow.getAllWindows().length > 0,
  openWindow,
  quit: () => app.quit(),
};

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
  app.dock?.setIcon(desktopIconPath);
  const updateSettings = createApplicationUpdateSettingsStore(
    join(app.getPath("userData"), "update-settings.json"),
  );
  const applicationUpdater = createApplicationUpdater(getAutoUpdater(), {
    packaged: app.isPackaged,
    saveSettings: updateSettings.write,
    settings: await updateSettings.read(),
  });
  registerApplicationUpdaterIpc(applicationUpdater);
  registerRepositoryFilesystemIpc(createElectronRepositoryFilesystem());
  desktopApplication = await startDesktopApplication({
    host,
    renderer: resolveRenderer(process.argv, import.meta.url, app.isPackaged),
    startEnvironment: startManagedEnvironmentServer,
  });
  void applicationUpdater.start();
}

function getAutoUpdater(): AppUpdater {
  return electronUpdater.autoUpdater;
}

async function openWindow(options: DesktopWindowOptions) {
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

  configureEnvironmentWebSocketOrigin(window, options.environmentOrigin);
  registerEnvironmentCredentialIpc(window, options);
  preventUntrustedNavigation(window, options.renderer);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
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
) {
  window.webContents.ipc.handle(
    desktopApplicationIpc.getEnvironmentCredential,
    (event) => {
      if (
        event.senderFrame !== window.webContents.mainFrame ||
        !isTrustedRendererLocation(options.renderer, event.senderFrame.url)
      ) {
        throw new Error(
          "Environment credentials require the main Rebase window.",
        );
      }
      return options.credential;
    },
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

function isTrustedRendererLocation(renderer: DesktopRenderer, target: string) {
  const targetUrl = new URL(target);
  if (renderer.type === "url") {
    return targetUrl.origin === new URL(renderer.url).origin;
  }
  return (
    targetUrl.protocol === "file:" &&
    fileURLToPath(targetUrl) === resolve(renderer.path)
  );
}

function configureEnvironmentWebSocketOrigin(
  window: BrowserWindow,
  environmentOrigin: string,
) {
  const webSocketOrigin = new URL(environmentOrigin);
  webSocketOrigin.protocol =
    webSocketOrigin.protocol === "https:" ? "wss:" : "ws:";

  window.webContents.session.webRequest.onBeforeSendHeaders(
    { types: ["webSocket"], urls: ["<all_urls>"] },
    (details, callback) => {
      if (new URL(details.url).origin !== webSocketOrigin.origin) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }

      const requestHeaders = { ...details.requestHeaders };
      const existingOrigin = Object.keys(requestHeaders).find(
        (header) => header.toLowerCase() === "origin",
      );
      if (existingOrigin !== undefined) delete requestHeaders[existingOrigin];
      requestHeaders.Origin = environmentOrigin;
      callback({ requestHeaders });
    },
  );
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
    path: fileURLToPath(
      process.env.NODE_ENV === "production"
        ? new URL("./web/index.html", moduleUrl)
        : new URL("../../web/dist/web/index.html", moduleUrl),
    ),
  };
}

function reportStartupFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
  dialog.showErrorBox("Rebase could not start", message);
  app.quit();
}
