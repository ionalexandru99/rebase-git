import { ipcMain } from "electron";
import { requireAbsoluteRepositoryPath } from "#desktop/features/repository-filesystem/repository-filesystem";
import type { RepositoryFilesystem } from "#desktop/features/repository-filesystem/repository-filesystem.contract";
import { repositoryFilesystemIpc } from "#desktop/features/repository-filesystem/repository-filesystem-ipc.contract";
import type { TrustedIpcHandler } from "#desktop/platform/renderer-trust/renderer-trust.contract";

export function registerRepositoryFilesystemIpc(
  filesystem: RepositoryFilesystem,
  trusted: TrustedIpcHandler,
) {
  ipcMain.handle(
    repositoryFilesystemIpc.revealRepository,
    trusted((_event, path: unknown) =>
      filesystem.revealRepository(requireAbsoluteRepositoryPath(path)),
    ),
  );
}
