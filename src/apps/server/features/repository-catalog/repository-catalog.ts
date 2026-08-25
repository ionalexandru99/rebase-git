import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { promisify } from "node:util";
import type { RepositoryCatalogEntry } from "@rebase/contracts";
import { asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import {
  type RepositoryCatalog,
  RepositoryCatalogError,
} from "#server/domain/repository-catalog.contract";
import type { EnvironmentContext } from "#server/persistence/environment-context.contract";
import { repositoryCatalogTable } from "#server/persistence/environment-state.schema";

const realpathNative = promisify(realpath.native);

export function createRepositoryCatalog(
  context: EnvironmentContext,
): RepositoryCatalog {
  return {
    list: () => listRepositories(context),
    recordOpened: (repositoryId) =>
      recordRepositoryOpened(context, repositoryId),
    remember: (path) => rememberRepository(context, path),
    remove: (repositoryId) => removeRepository(context, repositoryId),
  };
}

function listRepositories(context: EnvironmentContext) {
  return context.read("Could not read repository catalog", (database) =>
    database
      .select()
      .from(repositoryCatalogTable)
      .orderBy(
        asc(repositoryCatalogTable.name),
        asc(repositoryCatalogTable.path),
      ),
  );
}

function rememberRepository(
  context: EnvironmentContext,
  requestedPath: string,
) {
  return Effect.gen(function* () {
    const repositoryPath = yield* resolveRepositoryPath(requestedPath);
    const openedAt = new Date().toISOString();
    return yield* context.write(
      "Could not remember repository",
      async (database) => {
        const repository = await database
          .insert(repositoryCatalogTable)
          .values({
            addedAt: openedAt,
            id: randomUUID(),
            lastOpenedAt: openedAt,
            name: basename(repositoryPath),
            path: repositoryPath,
          })
          .onConflictDoUpdate({
            set: {
              lastOpenedAt: openedAt,
              name: basename(repositoryPath),
            },
            target: repositoryCatalogTable.path,
          })
          .returning()
          .get();
        return requireRepository(repository);
      },
    );
  });
}

function recordRepositoryOpened(
  context: EnvironmentContext,
  repositoryId: string,
) {
  return context
    .write("Could not record repository open", async (database) => {
      return database
        .update(repositoryCatalogTable)
        .set({ lastOpenedAt: new Date().toISOString() })
        .where(eq(repositoryCatalogTable.id, repositoryId))
        .returning()
        .get();
    })
    .pipe(
      Effect.flatMap((repository) =>
        repository === undefined
          ? Effect.fail(repositoryMissing(repositoryId))
          : Effect.succeed(repository),
      ),
    );
}

function removeRepository(context: EnvironmentContext, repositoryId: string) {
  return context
    .write("Could not remove repository", async (database) => {
      return database
        .delete(repositoryCatalogTable)
        .where(eq(repositoryCatalogTable.id, repositoryId))
        .returning({ repositoryId: repositoryCatalogTable.id })
        .get();
    })
    .pipe(
      Effect.flatMap((removed) =>
        removed === undefined
          ? Effect.fail(repositoryMissing(repositoryId))
          : Effect.succeed(removed),
      ),
    );
}

function resolveRepositoryPath(requestedPath: string) {
  if (
    requestedPath.length === 0 ||
    requestedPath.length > 4_096 ||
    requestedPath.includes("\0") ||
    !isAbsolute(requestedPath)
  ) {
    return Effect.fail(repositoryPathRejected("MalformedPath"));
  }

  return Effect.gen(function* () {
    const selectedPath = yield* canonicalizePath(requestedPath);
    const metadata = yield* inspectPath(selectedPath);
    if (!metadata.isDirectory()) {
      return yield* Effect.fail(repositoryPathRejected("NotDirectory"));
    }
    const worktreeRoot = yield* resolveGitWorktreeRoot(selectedPath);
    return yield* canonicalizePath(worktreeRoot);
  });
}

function canonicalizePath(path: string) {
  return Effect.tryPromise({
    try: () => realpathNative(path),
    catch: (cause) =>
      repositoryPathRejected(fileSystemRejectionReason(cause), cause),
  });
}

function inspectPath(path: string) {
  return Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) =>
      repositoryPathRejected(fileSystemRejectionReason(cause), cause),
  });
}

function resolveGitWorktreeRoot(path: string) {
  return Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        execFile(
          "git",
          [
            "-C",
            path,
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
          ],
          {
            encoding: "utf8",
            maxBuffer: 8_192,
            signal,
            timeout: 5_000,
          },
          (error, stdout) => {
            if (error) {
              reject(error);
              return;
            }
            const worktreeRoot = stdout.trim();
            if (worktreeRoot.length === 0 || !isAbsolute(worktreeRoot)) {
              reject(new Error("Git returned an invalid worktree root."));
              return;
            }
            resolve(worktreeRoot);
          },
        );
      }),
    catch: (cause) => repositoryPathRejected(gitRejectionReason(cause), cause),
  });
}

function fileSystemRejectionReason(cause: unknown) {
  return fileSystemErrorCode(cause) === "ENOENT"
    ? ("NotFound" as const)
    : ("InspectionFailed" as const);
}

function gitRejectionReason(cause: unknown) {
  const code = fileSystemErrorCode(cause);
  return code === "ENOENT" ||
    code === "ETIMEDOUT" ||
    code === "ABORT_ERR" ||
    code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" ||
    childProcessTimedOut(cause)
    ? ("InspectionFailed" as const)
    : ("NotRepository" as const);
}

function childProcessTimedOut(cause: unknown) {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "killed" in cause &&
    cause.killed === true &&
    "code" in cause &&
    cause.code === null
  );
}

function fileSystemErrorCode(cause: unknown) {
  return typeof cause === "object" && cause !== null && "code" in cause
    ? String(cause.code)
    : undefined;
}

function repositoryPathRejected(
  reason:
    | "InspectionFailed"
    | "MalformedPath"
    | "NotDirectory"
    | "NotFound"
    | "NotRepository",
  cause?: unknown,
) {
  return new RepositoryCatalogError({
    ...(cause === undefined ? {} : { cause }),
    failure: { _tag: "RepositoryPathRejected", reason },
  });
}

function repositoryMissing(repositoryId: string) {
  return new RepositoryCatalogError({
    failure: { _tag: "RepositoryMissing", repositoryId },
  });
}

function requireRepository(
  repository: RepositoryCatalogEntry | undefined,
): RepositoryCatalogEntry {
  if (repository === undefined) {
    throw new Error("The remembered repository was not returned.");
  }
  return repository;
}
