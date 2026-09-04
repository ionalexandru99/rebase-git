import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { RepositoryCatalogError } from "@rebase/server/domain/repository-catalog.contract";
import { createRepositoryCatalog } from "@rebase/server/features/repository-catalog/repository-catalog";
import { acquireEnvironmentContext } from "@rebase/server/persistence/environment-context";
import type { EnvironmentContext } from "@rebase/server/persistence/environment-context.contract";
import { repositoryCatalogTable } from "@rebase/server/persistence/environment-state.schema";
import { environmentPaths } from "@rebase/server/persistence/storage/environment-paths";
import type { EnvironmentStorageError } from "@rebase/server/persistence/storage/storage-error.contract";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

const execFilePromise = promisify(execFile);
const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  directories.clear();
});

describe("repository catalog", () => {
  it("remembers one canonical worktree root and keeps its identity stable", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "projects", "rebase git");
    const nestedPath = join(repositoryPath, "src", "nested");
    await createRepository(repositoryPath);
    await mkdir(nestedPath, { recursive: true });

    const result = await withCatalog(root, (catalog) =>
      Effect.gen(function* () {
        const first = yield* catalog.remember(nestedPath);
        const second = yield* catalog.remember(repositoryPath);
        return { first, repositories: yield* catalog.list(), second };
      }),
    );

    expect(result.first).toMatchObject({
      name: "rebase git",
      path: repositoryPath,
    });
    expect(result.first.id).toBe(result.second.id);
    expect(result.first.addedAt).toBe(result.second.addedAt);
    expect(result.repositories).toEqual([result.second]);
  });

  it("keeps linked worktrees as distinct repository entries", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "main");
    const worktreePath = join(root, "feature worktree");
    await createRepository(repositoryPath);
    await git(repositoryPath, "worktree", "add", worktreePath, "-b", "feature");

    const repositories = await withCatalog(root, (catalog) =>
      Effect.gen(function* () {
        yield* catalog.remember(repositoryPath);
        yield* catalog.remember(worktreePath);
        return yield* catalog.list();
      }),
    );

    expect(repositories.map(({ name, path }) => ({ name, path }))).toEqual([
      { name: "feature worktree", path: worktreePath },
      { name: "main", path: repositoryPath },
    ]);
    expect(repositories[0]?.logicalRepositoryId).toBe(
      repositories[1]?.logicalRepositoryId,
    );
  });

  it("creates a new logical identity after the last catalog entry is removed", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "repository");
    await createRepository(repositoryPath);

    const result = await withCatalog(root, (catalog) =>
      Effect.gen(function* () {
        const first = yield* catalog.remember(repositoryPath);
        yield* catalog.remove(first.id);
        const second = yield* catalog.remember(repositoryPath);
        return { first, second };
      }),
    );

    expect(result.second.logicalRepositoryId).not.toBe(
      result.first.logicalRepositoryId,
    );
  });

  it("repairs linked-worktree identities created before the identity migration", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "main");
    const worktreePath = join(root, "feature");
    await createRepository(repositoryPath);
    await git(repositoryPath, "worktree", "add", worktreePath, "-b", "feature");

    const result = await withCatalog(root, (catalog, context) =>
      Effect.gen(function* () {
        const main = yield* catalog.remember(repositoryPath);
        const feature = yield* catalog.remember(worktreePath);
        yield* context.write("Could not simulate legacy catalog", (database) =>
          database
            .update(repositoryCatalogTable)
            .set({ gitCommonDirectory: null, logicalRepositoryId: null }),
        );
        return {
          feature: yield* catalog.find(feature.id),
          main: yield* catalog.find(main.id),
        };
      }),
    );

    expect(result.feature?.logicalRepositoryId).toBeDefined();
    expect(result.feature?.logicalRepositoryId).toBe(
      result.main?.logicalRepositoryId,
    );
  });

  it("records an open and removes only the catalog entry", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "repository");
    await createRepository(repositoryPath);

    const result = await withCatalog(root, (catalog) =>
      Effect.gen(function* () {
        const remembered = yield* catalog.remember(repositoryPath);
        const opened = yield* catalog.recordOpened(remembered.id);
        const removed = yield* catalog.remove(remembered.id);
        return { opened, removed, repositories: yield* catalog.list() };
      }),
    );

    expect(result.opened.lastOpenedAt >= result.opened.addedAt).toBe(true);
    expect(result.removed.repositoryId).toBe(result.opened.id);
    expect(result.repositories).toEqual([]);
    await expect(access(repositoryPath)).resolves.toBeUndefined();
  });

  it("rejects malformed, missing, non-directory, and non-repository paths", async () => {
    const root = await createTemporaryDirectory();
    const plainDirectory = join(root, "plain");
    const plainFile = join(root, "plain-file");
    await mkdir(plainDirectory);
    await writeFile(plainFile, "plain", "utf8");

    await withCatalog(root, (catalog) =>
      Effect.gen(function* () {
        yield* expectFailure(catalog.remember("relative"), "MalformedPath");
        yield* expectFailure(
          catalog.remember(join(root, "missing")),
          "NotFound",
        );
        yield* expectFailure(catalog.remember(plainFile), "NotDirectory");
        yield* expectFailure(catalog.remember(plainDirectory), "NotRepository");
      }),
    );
  });

  it("reports missing repository ids for open and remove", async () => {
    const root = await createTemporaryDirectory();
    const missingId = "00000000-0000-4000-8000-000000000099";

    await withCatalog(root, (catalog) =>
      Effect.gen(function* () {
        yield* expectMissing(catalog.recordOpened(missingId), missingId);
        yield* expectMissing(catalog.remove(missingId), missingId);
      }),
    );
  });
});

function withCatalog<A, E>(
  root: string,
  use: (
    catalog: ReturnType<typeof createRepositoryCatalog>,
    context: EnvironmentContext,
  ) => Effect.Effect<A, E>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* acquireEnvironmentContext(
          environmentPaths(join(root, ".rebase")),
        );
        return yield* use(createRepositoryCatalog(context), context);
      }),
    ),
  );
}

function expectFailure<A>(
  effect: Effect.Effect<A, EnvironmentStorageError | RepositoryCatalogError>,
  reason: "MalformedPath" | "NotDirectory" | "NotFound" | "NotRepository",
) {
  return Effect.flip(effect).pipe(
    Effect.map((error) => {
      expect(error).toBeInstanceOf(RepositoryCatalogError);
      if (!(error instanceof RepositoryCatalogError)) return error;
      expect(error.failure).toEqual({ _tag: "RepositoryPathRejected", reason });
      return error;
    }),
  );
}

function expectMissing<A>(
  effect: Effect.Effect<A, EnvironmentStorageError | RepositoryCatalogError>,
  repositoryId: string,
) {
  return Effect.flip(effect).pipe(
    Effect.map((error) => {
      expect(error).toBeInstanceOf(RepositoryCatalogError);
      if (!(error instanceof RepositoryCatalogError)) return error;
      expect(error.failure).toEqual({
        _tag: "RepositoryMissing",
        repositoryId,
      });
      return error;
    }),
  );
}

async function createRepository(path: string) {
  await mkdir(path, { recursive: true });
  await git(path, "init", "-b", "main");
  await git(
    path,
    "-c",
    "user.name=Rebase test",
    "-c",
    "user.email=rebase@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "initial",
  );
}

async function git(path: string, ...arguments_: string[]) {
  await execFilePromise("git", ["-C", path, ...arguments_]);
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase catalog "));
  directories.add(directory);
  return realpath(directory);
}
