import { lstat, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { RepositoryCoordinationError } from "#server/domain/repository-coordination.contract";

const maximumMetadataBytes = 2 * 1024 * 1024;

export function readOperationFile(directory: string, name: string) {
  return Effect.tryPromise({
    try: async () => {
      try {
        const path = join(directory, name);
        if ((await stat(path)).size > maximumMetadataBytes)
          throw new Error("Operation metadata is too large.");
        return await readFile(path, "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    catch: () => inspectionFailed(`Could not read Git metadata: ${name}.`),
  });
}

export function operationFileStamp(directory: string, name: string) {
  return Effect.tryPromise({
    try: async () => {
      try {
        const info = await lstat(join(directory, name), { bigint: true });
        return `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    catch: () => inspectionFailed(`Could not inspect Git metadata: ${name}.`),
  });
}

export function inspectionFailed(detail: string) {
  return new RepositoryCoordinationError({
    reason: "Unavailable",
    detail: detail.slice(0, 2048),
  });
}

function isMissing(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
