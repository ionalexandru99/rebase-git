import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog } from "electron";
import {
  type DesktopApplication,
  startDesktopApplication,
} from "#desktop/features/desktop-application/desktop-application";
import type {
  DesktopApplicationHost,
  DesktopRenderer,
  DesktopWindowOptions,
} from "#desktop/features/desktop-application/desktop-application.contract";
import { startManagedEnvironmentServer } from "#desktop/features/environment-supervision/environment-supervisor";

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
  desktopApplication = await startDesktopApplication({
    host,
    renderer: resolveRenderer(process.argv, import.meta.url),
    startEnvironment: startManagedEnvironmentServer,
  });
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
        `--rebase-pairing-material=${options.pairingMaterial}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      preload: fileURLToPath(new URL("./preload.cjs", import.meta.url)),
      sandbox: true,
    },
    width: 1200,
  });

  configureEnvironmentWebSocketOrigin(window, options.environmentOrigin);
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
): DesktopRenderer {
  const rendererUrl = arguments_
    .find((argument) => argument.startsWith("--renderer-url="))
    ?.slice("--renderer-url=".length);

  if (rendererUrl !== undefined) {
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
