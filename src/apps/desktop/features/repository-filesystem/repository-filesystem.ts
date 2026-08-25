import { isAbsolute } from "node:path";
import type {
  RepositoryFilesystem,
  RepositoryFilesystemPlatform,
} from "#desktop/features/repository-filesystem/repository-filesystem.contract";

export function createRepositoryFilesystem(
  platform: RepositoryFilesystemPlatform,
): RepositoryFilesystem {
  return {
    revealRepository: async (path) => {
      const repositoryPath = requireAbsoluteRepositoryPath(path);
      platform.showItemInFolder(repositoryPath);
    },
  };
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
