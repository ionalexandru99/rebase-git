import type {
  DesktopUpdateSnapshot,
  DesktopUpdates,
  ReleaseChannel,
} from "@rebase/contracts";
import { contextBridge, ipcRenderer } from "electron";
import type { DesktopHostBridge } from "#desktop/desktop-host.contract";
import { applicationUpdaterIpc } from "#desktop/features/application-updates/application-updater-ipc.contract";

const host = Object.freeze({
  environmentOrigin: readRequiredArgument("--rebase-environment-origin="),
  pairingMaterial: readRequiredArgument("--rebase-pairing-material="),
  updates: createDesktopUpdatesBridge(),
}) satisfies DesktopHostBridge;
contextBridge.exposeInMainWorld("rebaseHost", host);

function readRequiredArgument(prefix: string) {
  const value = process.argv
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);

  if (value === undefined) {
    throw new Error(
      `The Electron host did not provide ${prefix.slice(2, -1)}.`,
    );
  }

  return value;
}

function createDesktopUpdatesBridge(): DesktopUpdates {
  return Object.freeze({
    checkForUpdates: () => ipcRenderer.invoke(applicationUpdaterIpc.check),
    getSnapshot: () => ipcRenderer.invoke(applicationUpdaterIpc.snapshot),
    installUpdate: () => ipcRenderer.invoke(applicationUpdaterIpc.install),
    selectReleaseChannel: (channel: ReleaseChannel) =>
      ipcRenderer.invoke(applicationUpdaterIpc.selectReleaseChannel, channel),
    setCheckAutomatically: (enabled: boolean) =>
      ipcRenderer.invoke(applicationUpdaterIpc.setCheckAutomatically, enabled),
    subscribe: (listener: (snapshot: DesktopUpdateSnapshot) => void) => {
      const handleSnapshot = (
        _event: Electron.IpcRendererEvent,
        snapshot: DesktopUpdateSnapshot,
      ) => listener(snapshot);
      ipcRenderer.on(applicationUpdaterIpc.snapshotChanged, handleSnapshot);
      return () =>
        ipcRenderer.removeListener(
          applicationUpdaterIpc.snapshotChanged,
          handleSnapshot,
        );
    },
  });
}
