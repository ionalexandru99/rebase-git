import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { operationError } from "#server/features/repository-operations/git/operation-errors";

export function operationGit(
  git: GitCommandRunner,
  directory: string,
  args: readonly string[],
) {
  return git.run({ directory, arguments: args }).pipe(
    Effect.mapError(() =>
      operationError(
        "InspectionFailed",
        "Could not inspect the worktree's Git state.",
      ),
    ),
    Effect.flatMap((output) =>
      output.exitCode === 0
        ? Effect.succeed(output.stdout)
        : Effect.fail(
            operationError(
              "InspectionFailed",
              output.stderr || "Could not inspect Git state.",
            ),
          ),
    ),
  );
}

export function resolveOperationDirectories(
  git: GitCommandRunner,
  directory: string,
) {
  return Effect.gen(function* () {
    const gitDirectory = (yield* operationGit(git, directory, [
      "rev-parse",
      "--absolute-git-dir",
    ])).trimEnd();
    const commonDirectory = (yield* operationGit(git, directory, [
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ])).trimEnd();
    return yield* Effect.tryPromise({
      try: async () => ({
        gitDirectory: await realpath(gitDirectory),
        commonDirectory: await realpath(commonDirectory),
      }),
      catch: () =>
        operationError(
          "InspectionFailed",
          "Could not resolve the worktree's Git directories.",
        ),
    });
  });
}

export function readOperationFile(directory: string, name: string) {
  return Effect.tryPromise({
    try: async () => {
      try {
        const path = join(directory, name);
        const info = await stat(path);
        if (info.size > 2 * 1024 * 1024)
          throw new Error("Operation metadata is too large.");
        return await readFile(path, "utf8");
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    catch: () =>
      operationError(
        "InspectionFailed",
        `Could not read Git metadata: ${name}.`,
      ),
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
    catch: () =>
      operationError(
        "InspectionFailed",
        `Could not inspect Git metadata: ${name}.`,
      ),
  });
}

function isMissing(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}
