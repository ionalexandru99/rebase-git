import { shell } from "electron";
import { createRepositoryFilesystem } from "#desktop/features/repository-filesystem/repository-filesystem";

export function createElectronRepositoryFilesystem() {
  return createRepositoryFilesystem({
    showItemInFolder: (path) => shell.showItemInFolder(path),
  });
}
