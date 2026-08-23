import {
  type DesktopUpdateSnapshot,
  ReleaseChannelSchema,
} from "@rebase/contracts";
import { Schema } from "effect";
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import type { ApplicationUpdater } from "#desktop/features/application-updates/application-updater.contract";
import { applicationUpdaterIpc } from "#desktop/features/application-updates/application-updater-ipc.contract";

export function registerApplicationUpdaterIpc(updater: ApplicationUpdater) {
  ipcMain.handle(
    applicationUpdaterIpc.snapshot,
    trustedHandler(() => updater.getSnapshot()),
  );
  ipcMain.handle(
    applicationUpdaterIpc.check,
    trustedHandler(() => updater.checkForUpdates()),
  );
  ipcMain.handle(
    applicationUpdaterIpc.install,
    trustedHandler(() => updater.installUpdate()),
  );
  ipcMain.handle(
    applicationUpdaterIpc.selectReleaseChannel,
    trustedHandler((_event, value: unknown) =>
      updater.selectReleaseChannel(
        Schema.decodeUnknownSync(ReleaseChannelSchema)(value),
      ),
    ),
  );
  ipcMain.handle(
    applicationUpdaterIpc.setCheckAutomatically,
    trustedHandler((_event, value: unknown) => {
      if (typeof value !== "boolean") {
        throw new TypeError("checkAutomatically must be a boolean.");
      }
      return updater.setCheckAutomatically(value);
    }),
  );

  return updater.subscribe(sendSnapshot);
}

function trustedHandler<Arguments extends readonly unknown[], Result>(
  handler: (event: IpcMainInvokeEvent, ...arguments_: Arguments) => Result,
) {
  return (event: IpcMainInvokeEvent, ...arguments_: Arguments) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (
      window === null ||
      window.isDestroyed() ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error("Updater commands require the main Rebase window.");
    }
    return handler(event, ...arguments_);
  };
}

function sendSnapshot(snapshot: DesktopUpdateSnapshot) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(applicationUpdaterIpc.snapshotChanged, snapshot);
  }
}
