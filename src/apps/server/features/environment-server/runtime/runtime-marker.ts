import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  errorMessage,
  isFileSystemError,
} from "@rebase/server/error-inspection";
import { RuntimeMarkerError } from "@rebase/server/features/environment-server/runtime/runtime-errors.contract";
import type { RuntimeMarker } from "@rebase/server/features/environment-server/runtime/runtime-marker.contract";
import { defaultEnvironmentPaths } from "@rebase/server/persistence/storage/environment-paths";
import { Effect, type Scope } from "effect";

export function defaultRuntimePath(): string {
  return defaultEnvironmentPaths().runtimeMarker;
}

export function acquireRuntimeMarker(
  marker: RuntimeMarker,
  runtimePath = defaultRuntimePath(),
): Effect.Effect<void, RuntimeMarkerError, Scope.Scope> {
  return Effect.acquireRelease(writeRuntimeMarker(runtimePath, marker), () =>
    removeRuntimeMarker(runtimePath, marker.pid).pipe(
      Effect.catchTag("RuntimeMarkerError", reportCleanupFailure),
    ),
  ).pipe(Effect.asVoid);
}

function writeRuntimeMarker(runtimePath: string, marker: RuntimeMarker) {
  const temporaryPath = `${runtimePath}.${process.pid}.${randomUUID()}.tmp`;

  return Effect.gen(function* () {
    yield* fileSystemOperation(() =>
      mkdir(dirname(runtimePath), { recursive: true }),
    );
    yield* fileSystemOperation(() =>
      writeFile(temporaryPath, `${JSON.stringify(marker)}\n`, { mode: 0o600 }),
    );
    yield* replaceFile(temporaryPath, runtimePath);
  }).pipe(
    Effect.ensuring(
      fileSystemOperation(() => rm(temporaryPath, { force: true })).pipe(
        Effect.orDie,
      ),
    ),
  );
}

function removeRuntimeMarker(runtimePath: string, pid: number) {
  return Effect.gen(function* () {
    const contents = yield* fileSystemOperation(() =>
      readFile(runtimePath, "utf8"),
    );
    const marker = yield* Effect.try({
      try: () => JSON.parse(contents) as { pid?: unknown },
      catch: runtimeMarkerError,
    });
    if (marker.pid === pid) {
      yield* fileSystemOperation(() => rm(runtimePath));
    }
  }).pipe(
    Effect.catchTag("RuntimeMarkerError", (error) =>
      isMissingFile(error.cause) ? Effect.void : Effect.fail(error),
    ),
  );
}

function replaceFile(source: string, destination: string) {
  return fileSystemOperation(() => rename(source, destination)).pipe(
    Effect.catchTag("RuntimeMarkerError", (error) => {
      if (!isReplaceConflict(error.cause)) {
        return Effect.fail(error);
      }

      return Effect.gen(function* () {
        yield* fileSystemOperation(() => rm(destination, { force: true }));
        yield* fileSystemOperation(() => rename(source, destination));
      });
    }),
  );
}

function fileSystemOperation<A>(operation: () => Promise<A>) {
  return Effect.tryPromise({
    try: operation,
    catch: runtimeMarkerError,
  });
}

function runtimeMarkerError(cause: unknown) {
  return new RuntimeMarkerError({
    cause,
    message: `Could not update the runtime marker: ${errorMessage(cause)}`,
  });
}

function reportCleanupFailure(error: RuntimeMarkerError) {
  return Effect.sync(() => {
    process.stderr.write(`${error.message}\n`);
  });
}

function isMissingFile(error: unknown) {
  return isFileSystemError(error) && error.code === "ENOENT";
}

function isReplaceConflict(error: unknown) {
  return (
    isFileSystemError(error) &&
    (error.code === "EEXIST" || error.code === "EPERM")
  );
}
