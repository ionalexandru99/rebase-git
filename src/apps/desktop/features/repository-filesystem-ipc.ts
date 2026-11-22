import { isAbsolute } from "node:path";
import { ipcMain, shell } from "electron";
import { repositoryFilesystemIpc } from "#desktop/ipc-channels.ts";
import type { TrustedIpcHandler } from "#desktop/platform/renderer-trust.ts";

export function registerRepositoryFilesystemIpc(trusted: TrustedIpcHandler) {
  ipcMain.handle(
    repositoryFilesystemIpc.revealRepository,
    trusted((_event, path: unknown) => {
      shell.showItemInFolder(requireAbsoluteRepositoryPath(path));
    }),
  );
}

export function requireAbsoluteRepositoryPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    !isAbsolute(value)
  ) {
    throw new TypeError(
      "Repository reveal requires a non-empty absolute path.",
    );
  }

  return value;
}
