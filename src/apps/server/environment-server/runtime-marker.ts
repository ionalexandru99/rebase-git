import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Data, Effect, type Scope } from "effect";

export interface RuntimeMarker {
  readonly host: string;
  readonly origin: string;
  readonly pid: number;
  readonly port: number;
  readonly startedAt: string;
}

export class RuntimeMarkerError extends Data.TaggedError("RuntimeMarkerError")<{
  readonly cause: unknown;
  readonly message: string;
}> {}

export function defaultRuntimePath(): string {
  return join(homedir(), ".rebase", "runtime.json");
}

export function acquireRuntimeMarker(
  marker: RuntimeMarker,
): Effect.Effect<void, RuntimeMarkerError, Scope.Scope> {
  const runtimePath = defaultRuntimePath();

  return Effect.acquireRelease(writeRuntimeMarker(runtimePath, marker), () =>
    removeRuntimeMarker(runtimePath, marker.pid).pipe(Effect.orDie),
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
      if (!isReplaceConflict(error.cause)) return Effect.fail(error);

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

function isMissingFile(error: unknown) {
  return isFileSystemError(error) && error.code === "ENOENT";
}

function isReplaceConflict(error: unknown) {
  return (
    isFileSystemError(error) &&
    (error.code === "EEXIST" || error.code === "EPERM")
  );
}

function isFileSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
