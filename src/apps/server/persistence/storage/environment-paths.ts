import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { errorMessage } from "#server/error-inspection";
import { EnvironmentStorageError } from "#server/persistence/sqlite/storage-operation";

export interface EnvironmentPaths {
  readonly cacheDirectory: string;
  readonly root: string;
  readonly runtimeDirectory: string;
  readonly runtimeMarker: string;
  readonly secretsDirectory: string;
  readonly serverSecret: string;
  readonly settingsDirectory: string;
  readonly stateDatabase: string;
  readonly stateDirectory: string;
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
