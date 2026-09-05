import { chmod, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { EnvironmentStorageError } from "#server/domain/environment-storage-error.contract";
import { errorMessage } from "#server/error-inspection";
import type { EnvironmentPaths } from "#server/persistence/storage/environment-paths.contract";

export function defaultEnvironmentPaths() {
  return environmentPaths(join(homedir(), ".rebase"));
}

export function environmentPaths(root: string): EnvironmentPaths {
  const cacheDirectory = join(root, "cache");
  const runtimeDirectory = join(root, "runtime");
  const secretsDirectory = join(root, "secrets");
  const settingsDirectory = join(root, "settings");
  const stateDirectory = join(root, "state");

  return {
    cacheDirectory,
    root,
    runtimeDirectory,
    runtimeMarker: join(runtimeDirectory, "runtime.json"),
    secretsDirectory,
    serverSecret: join(secretsDirectory, "server.key"),
    settingsDirectory,
    stateDatabase: join(stateDirectory, "state.sqlite"),
    stateDirectory,
  };
}

export function prepareEnvironmentDirectories(paths: EnvironmentPaths) {
  const directories = [
    paths.root,
    paths.stateDirectory,
    paths.runtimeDirectory,
    paths.settingsDirectory,
    paths.secretsDirectory,
    paths.cacheDirectory,
  ];

  return Effect.tryPromise({
    try: async () => {
      for (const directory of directories) {
        await mkdir(directory, { mode: 0o700, recursive: true });
        if (process.platform !== "win32") {
          await chmod(directory, 0o700);
        }
      }
    },
    catch: (cause) =>
      new EnvironmentStorageError({
        cause,
        message: `Could not prepare Environment storage: ${errorMessage(cause)}`,
      }),
  });
}
