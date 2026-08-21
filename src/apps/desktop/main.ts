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
    void shutdown.finally(() => app.exit(0)).catch(reportStartupFailure);
  });
}

try {
  await app.whenReady();
  desktopApplication = await startDesktopApplication({
    host,
    renderer: resolveRenderer(process.argv, import.meta.url),
    startEnvironment: startManagedEnvironmentServer,
  });
} catch (error) {
  reportStartupFailure(error);
}

async function openWindow(options: DesktopWindowOptions) {
  const window = new BrowserWindow({
    backgroundColor: "#000000",
    height: 800,
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
    path: fileURLToPath(new URL("../../web/dist/web/index.html", moduleUrl)),
  };
}

function reportStartupFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  dialog.showErrorBox("Rebase could not start", message);
  app.quit();
}
