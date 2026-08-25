import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";
import { requireAbsoluteRepositoryPath } from "#desktop/features/repository-filesystem/repository-filesystem";
import type { RepositoryFilesystem } from "#desktop/features/repository-filesystem/repository-filesystem.contract";
import { repositoryFilesystemIpc } from "#desktop/features/repository-filesystem/repository-filesystem-ipc.contract";

export function registerRepositoryFilesystemIpc(
  filesystem: RepositoryFilesystem,
) {
  ipcMain.handle(
    repositoryFilesystemIpc.revealRepository,
    trustedHandler((_event, path: unknown) =>
      filesystem.revealRepository(requireAbsoluteRepositoryPath(path)),
    ),
  );
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
      throw new Error(
        "Repository filesystem commands require the main Rebase window.",
      );
    }
    return handler(event, ...arguments_);
  };
}
