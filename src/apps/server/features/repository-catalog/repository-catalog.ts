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
    find: (repositoryId) => findRepository(context, repositoryId),
    list: () => listRepositories(context),
    recordOpened: (repositoryId) =>
      recordRepositoryOpened(context, repositoryId),
    remember: (path) => rememberRepository(context, path),
    remove: (repositoryId) => removeRepository(context, repositoryId),
  };
}

function listRepositories(context: EnvironmentContext) {
  return context
    .read("Could not read repository catalog", (database) =>
      database
        .select()
        .from(repositoryCatalogTable)
        .orderBy(
          asc(repositoryCatalogTable.name),
          asc(repositoryCatalogTable.path),
        ),
    )
    .pipe(Effect.map((repositories) => repositories.map(catalogEntry)));
}

function findRepository(context: EnvironmentContext, repositoryId: string) {
  return context
    .read("Could not read repository", (database) =>
      database
        .select()
        .from(repositoryCatalogTable)
        .where(eq(repositoryCatalogTable.id, repositoryId))
        .get(),
    )
    .pipe(
      Effect.flatMap((repository) =>
        repository === undefined
          ? Effect.succeed(undefined)
          : ensureRepositoryIdentity(context, repository),
      ),
      Effect.map((repository) =>
        repository === undefined ? undefined : catalogEntry(repository),
      ),
    );
}

function ensureRepositoryIdentity(
  context: EnvironmentContext,
  repository: typeof repositoryCatalogTable.$inferSelect,
) {
  if (
    repository.gitCommonDirectory !== null &&
    repository.logicalRepositoryId !== null
  ) {
    return Effect.succeed(repository);
  }

  return resolveRepository(repository.path).pipe(
    Effect.flatMap((resolved) =>
      context.write(
        "Could not repair repository identity",
        async (database) => {
          const linkedRepository = await database
            .select({
              logicalRepositoryId: repositoryCatalogTable.logicalRepositoryId,
            })
            .from(repositoryCatalogTable)
            .where(
              eq(
                repositoryCatalogTable.gitCommonDirectory,
                resolved.gitCommonDirectory,
              ),
            )
            .get();
          const logicalRepositoryId =
            linkedRepository?.logicalRepositoryId ??
            repository.logicalRepositoryId ??
            randomUUID();
          const repaired = await database
            .update(repositoryCatalogTable)
            .set({
              gitCommonDirectory: resolved.gitCommonDirectory,
              logicalRepositoryId,
            })
            .where(eq(repositoryCatalogTable.id, repository.id))
            .returning()
            .get();
          return repaired ?? repository;
        },
      ),
    ),
    Effect.catch(() => Effect.succeed(repository)),
  );
}

function rememberRepository(
  context: EnvironmentContext,
  requestedPath: string,
) {
  return Effect.gen(function* () {
    const repository = yield* resolveRepository(requestedPath);
    const openedAt = new Date().toISOString();
    return yield* context.write(
      "Could not remember repository",
      async (database) => {
        const linkedRepository = await database
          .select({
            logicalRepositoryId: repositoryCatalogTable.logicalRepositoryId,
          })
          .from(repositoryCatalogTable)
          .where(
            eq(
              repositoryCatalogTable.gitCommonDirectory,
              repository.gitCommonDirectory,
            ),
          )
          .get();
        const logicalRepositoryId =
          linkedRepository?.logicalRepositoryId ?? randomUUID();
        const remembered = await database
          .insert(repositoryCatalogTable)
          .values({
            addedAt: openedAt,
            gitCommonDirectory: repository.gitCommonDirectory,
            id: randomUUID(),
            lastOpenedAt: openedAt,
            logicalRepositoryId,
            name: basename(repository.path),
            path: repository.path,
          })
          .onConflictDoUpdate({
            set: {
              gitCommonDirectory: repository.gitCommonDirectory,
              lastOpenedAt: openedAt,
              logicalRepositoryId,
              name: basename(repository.path),
            },
            target: repositoryCatalogTable.path,
          })
          .returning()
          .get();
        return catalogEntry(requireStoredRepository(remembered));
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
          : Effect.succeed(catalogEntry(repository)),
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

function resolveRepository(requestedPath: string) {
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
    const git = yield* resolveGitPaths(selectedPath);
    const [path, gitCommonDirectory] = yield* Effect.all([
      canonicalizePath(git.worktreeRoot),
      canonicalizePath(git.commonDirectory),
    ]);
    return { gitCommonDirectory, path };
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

function resolveGitPaths(path: string) {
  return Effect.tryPromise({
    try: (signal) =>
      new Promise<{
        readonly commonDirectory: string;
        readonly worktreeRoot: string;
      }>((resolve, reject) => {
        execFile(
          "git",
          [
            "-C",
            path,
            "rev-parse",
            "--path-format=absolute",
            "--show-toplevel",
            "--git-common-dir",
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
            const [worktreeRoot, commonDirectory, ...extra] = stdout
              .trim()
              .split("\n");
            if (
              worktreeRoot === undefined ||
              commonDirectory === undefined ||
              extra.length > 0 ||
              !isAbsolute(worktreeRoot) ||
              !isAbsolute(commonDirectory)
            ) {
              reject(new Error("Git returned invalid repository paths."));
              return;
            }
            resolve({ commonDirectory, worktreeRoot });
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

function requireStoredRepository(
  repository: typeof repositoryCatalogTable.$inferSelect | undefined,
) {
  if (repository === undefined) {
    throw new Error("The remembered repository was not returned.");
  }
  return repository;
}

function catalogEntry(
  repository: typeof repositoryCatalogTable.$inferSelect,
): RepositoryCatalogEntry {
  return {
    addedAt: repository.addedAt,
    id: repository.id,
    lastOpenedAt: repository.lastOpenedAt,
    ...(repository.logicalRepositoryId === null
      ? {}
      : { logicalRepositoryId: repository.logicalRepositoryId }),
    name: repository.name,
    path: repository.path,
  };
}
