import {
  type DesktopUpdateSnapshot,
  ReleaseChannelSchema,
} from "@rebase/contracts";
import { Schema } from "effect";
import { BrowserWindow, ipcMain } from "electron";
import type { ApplicationUpdater } from "#desktop/features/application-updates/application-updater.contract";
import { applicationUpdaterIpc } from "#desktop/features/application-updates/application-updater-ipc.contract";
import type { TrustedIpcHandler } from "#desktop/platform/renderer-trust/renderer-trust.contract";

export function registerApplicationUpdaterIpc(
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
        Schema.decodeUnknownSync(ReleaseChannelSchema)(value),
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
