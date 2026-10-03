import { randomUUID } from "node:crypto";
import { realpath } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { promisify } from "node:util";
import { and, asc, countDistinct, eq, ne, notExists, sql } from "drizzle-orm";
import { Effect } from "effect";
import { repositoryRejected } from "#contracts/git/git-failures.contract.ts";
import {
  RepositoryCatalogApi,
  type RepositoryCatalogEntry,
  RepositoryColor,
  type RepositoryPathRejected,
} from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-routes.ts";
import { route } from "#server/adapters/environment-transport/environment-routes.ts";
import {
  type GitCommandRunner,
  isGitRejection,
  runRepositoryGit,
} from "#server/adapters/local-git/git-commands.ts";
import type { RepositoryCreation } from "#server/features/repository-catalog/create-repository.ts";
import type { EnvironmentContext } from "#server/persistence/environment-context.ts";
import {
  repositoryCatalogTable,
  repositorySettingTable,
} from "#server/persistence/environment-state.schema.ts";

const realpathNative = promisify(realpath.native);

export type RepositoryCatalog = ReturnType<typeof createRepositoryCatalog>;

export function createRepositoryCatalog(
  context: EnvironmentContext,
  git: GitCommandRunner,
) {
  return {
    find: (repositoryId: string) => findRepository(context, git, repositoryId),
    list: () => listRepositories(context),
    recordOpened: (repositoryId: string) =>
      recordRepositoryOpened(context, repositoryId),
    remember: (path: string, repositoryId?: string) =>
      rememberRepository(context, git, path, repositoryId),
    remove: (repositoryId: string) => removeRepository(context, repositoryId),
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

function findRepository(
  context: EnvironmentContext,
  git: GitCommandRunner,
  repositoryId: string,
) {
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
          : ensureRepositoryIdentity(context, git, repository),
      ),
      Effect.map((repository) =>
        repository === undefined ? undefined : catalogEntry(repository),
      ),
    );
}

function ensureRepositoryIdentity(
  context: EnvironmentContext,
  git: GitCommandRunner,
  repository: typeof repositoryCatalogTable.$inferSelect,
) {
  if (
    repository.gitCommonDirectory !== null &&
    repository.logicalRepositoryId !== null
  ) {
    return Effect.succeed(repository);
  }

  return resolveRepository(git, repository.path).pipe(
    Effect.flatMap((resolved) =>
      context.write(
        "Could not repair repository identity",
        async (database) => {
          const linkedRepository = await database
            .select({
              color: repositoryCatalogTable.color,
              logicalRepositoryId: repositoryCatalogTable.logicalRepositoryId,
            })
            .from(repositoryCatalogTable)
            .where(
              and(
                eq(
                  repositoryCatalogTable.gitCommonDirectory,
                  resolved.gitCommonDirectory,
                ),
                ne(repositoryCatalogTable.id, repository.id),
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
              color: linkedRepository?.color ?? repository.color,
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
  git: GitCommandRunner,
  requestedPath: string,
  repositoryId: string = randomUUID(),
) {
  return Effect.gen(function* () {
    const repository = yield* resolveRepository(git, requestedPath);
    const openedAt = new Date().toISOString();
    return yield* context.write(
      "Could not remember repository",
      async (database) => {
        const linkedRepository = await database
          .select({
            color: repositoryCatalogTable.color,
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
        const color =
          linkedRepository?.color ??
          leastUsedColor(
            await database
              .select({
                color: repositoryCatalogTable.color,
                repositories: countDistinct(
                  sql`coalesce(${repositoryCatalogTable.logicalRepositoryId}, ${repositoryCatalogTable.id})`,
                ),
              })
              .from(repositoryCatalogTable)
              .groupBy(repositoryCatalogTable.color),
          );
        const remembered = await database
          .insert(repositoryCatalogTable)
          .values({
            addedAt: openedAt,
            color,
            gitCommonDirectory: repository.gitCommonDirectory,
            id: repositoryId,
            lastOpenedAt: openedAt,
            logicalRepositoryId,
            name: basename(repository.path),
            path: repository.path,
          })
          .onConflictDoUpdate({
            set: {
              color,
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

function leastUsedColor(
  usage: readonly {
    readonly color: RepositoryColor;
    readonly repositories: number;
  }[],
): RepositoryColor {
  const repositoriesWith = (color: RepositoryColor) =>
    usage.find((used) => used.color === color)?.repositories ?? 0;
  return RepositoryColor.literals.reduce((least, color) =>
    repositoriesWith(color) < repositoriesWith(least) ? color : least,
  );
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
          ? Effect.fail(repositoryMissing())
          : Effect.succeed(catalogEntry(repository)),
      ),
    );
}

function removeRepository(context: EnvironmentContext, repositoryId: string) {
  return context
    .write("Could not remove repository", async (database) => {
      const removed = await database
        .delete(repositoryCatalogTable)
        .where(eq(repositoryCatalogTable.id, repositoryId))
        .returning({
          id: repositoryCatalogTable.id,
          logicalRepositoryId: repositoryCatalogTable.logicalRepositoryId,
        })
        .get();
      if (removed === undefined) return undefined;
      const logicalRepositoryId = removed.logicalRepositoryId ?? removed.id;
      await database.delete(repositorySettingTable).where(
        and(
          eq(repositorySettingTable.repositoryId, logicalRepositoryId),
          notExists(
            database
              .select({ id: repositoryCatalogTable.id })
              .from(repositoryCatalogTable)
              .where(
                eq(
                  sql`coalesce(${repositoryCatalogTable.logicalRepositoryId}, ${repositoryCatalogTable.id})`,
                  logicalRepositoryId,
                ),
              ),
          ),
        ),
      );
      return { repositoryId: removed.id };
    })
    .pipe(
      Effect.flatMap((removed) =>
        removed === undefined
          ? Effect.fail(repositoryMissing())
          : Effect.succeed(removed),
      ),
    );
}

function resolveRepository(git: GitCommandRunner, requestedPath: string) {
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
    const resolved = yield* resolveGitPaths(git, selectedPath);
    const [path, gitCommonDirectory] = yield* Effect.all([
      canonicalizePath(resolved.worktreeRoot),
      canonicalizePath(resolved.commonDirectory),
    ]);
    return { gitCommonDirectory, path };
  });
}

function canonicalizePath(path: string) {
  return Effect.tryPromise({
    try: () => realpathNative(path),
    catch: (cause) => repositoryPathRejected(fileSystemRejectionReason(cause)),
  });
}

function inspectPath(path: string) {
  return Effect.tryPromise({
    try: () => stat(path),
    catch: (cause) => repositoryPathRejected(fileSystemRejectionReason(cause)),
  });
}

function resolveGitPaths(git: GitCommandRunner, path: string) {
  return Effect.gen(function* () {
    const output = yield* runRepositoryGit(
      git,
      path,
      [
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--git-common-dir",
      ],
      { maxOutputBytes: 8_192, timeoutMilliseconds: 5_000 },
    ).pipe(
      Effect.mapError((cause) =>
        isGitRejection(cause)
          ? repositoryPathRejected("NotRepository")
          : repositoryPathRejected("InspectionFailed"),
      ),
    );
    const [worktreeRoot, commonDirectory, ...extra] = output.trim().split("\n");
    if (
      worktreeRoot === undefined ||
      commonDirectory === undefined ||
      extra.length > 0 ||
      !isAbsolute(worktreeRoot) ||
      !isAbsolute(commonDirectory)
    ) {
      return yield* Effect.fail(repositoryPathRejected("NotRepository"));
    }
    return { commonDirectory, worktreeRoot };
  });
}

function fileSystemRejectionReason(cause: unknown) {
  return fileSystemErrorCode(cause) === "ENOENT"
    ? ("NotFound" as const)
    : ("InspectionFailed" as const);
}

function fileSystemErrorCode(cause: unknown) {
  return typeof cause === "object" && cause !== null && "code" in cause
    ? String(cause.code)
    : undefined;
}

function repositoryPathRejected(
  reason: RepositoryPathRejected["reason"],
): RepositoryPathRejected {
  return { _tag: "RepositoryPathRejected", reason };
}

function repositoryMissing() {
  return repositoryRejected(
    "Missing",
    "This repository is no longer available.",
  );
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
    color: repository.color,
    id: repository.id,
    lastOpenedAt: repository.lastOpenedAt,
    ...(repository.logicalRepositoryId === null
      ? {}
      : { logicalRepositoryId: repository.logicalRepositoryId }),
    name: repository.name,
    path: repository.path,
  };
}

export function repositoryCatalogFeature(
  catalog: RepositoryCatalog,
  creation: RepositoryCreation,
): EnvironmentFeature {
  const api = RepositoryCatalogApi;
  return {
    routes: [
      route(api.list, () =>
        Effect.map(catalog.list(), (repositories) => ({ repositories })),
      ),
      route(api.remember, (input) => catalog.remember(input.path)),
      route(api.recordOpened, (input) =>
        catalog.recordOpened(input.repositoryId),
      ),
      route(api.remove, (input) => catalog.remove(input.repositoryId)),
      route(api.defaults, () => creation.defaults),
      route(api.setCloneFolder, (input) => creation.setCloneFolder(input.path)),
      route(api.clone, (input) => creation.clone(input)),
      route(api.initialize, (input) => creation.initialize(input)),
    ],
  };
}
