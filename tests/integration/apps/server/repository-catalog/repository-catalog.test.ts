import { access, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Stream } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import {
  GitCommandError,
  type GitCommandRunner,
} from "#server/domain/git-command.contract";
import { createRepositoryCatalog } from "#server/features/repository-catalog/repository-catalog";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import type { EnvironmentContext } from "#server/persistence/environment-context.contract";
import { repositoryCatalogTable } from "#server/persistence/environment-state.schema";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import { createRepository, git } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const directories = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) => removeTemporaryDirectory(directory)),
  );
  directories.clear();
});

describe("repository catalog", () => {
  it("reports unavailable Git without remembering the path", async () => {
    const root = await createTemporaryDirectory();
    const unavailable: GitCommandRunner = {
      run: () => Effect.fail(new GitCommandError({ reason: "GitUnavailable" })),
      stream: () =>
        Stream.fail(new GitCommandError({ reason: "GitUnavailable" })),
    };
    const result = await withCatalog(
      root,
      (catalog) =>
        Effect.gen(function* () {
          const error = yield* Effect.flip(catalog.remember(root));
          return { error, repositories: yield* catalog.list() };
        }),
      unavailable,
    );
    expect(result.error).toMatchObject({ reason: "InspectionFailed" });
    expect(result.repositories).toEqual([]);
  });

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
        yield* expectMissing(catalog.recordOpened(missingId));
        yield* expectMissing(catalog.remove(missingId));
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
  git: GitCommandRunner = createLocalGitCommandRunner(),
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* acquireEnvironmentContext(
          environmentPaths(join(root, ".rebase")),
        );
        return yield* use(createRepositoryCatalog(context, git), context);
      }),
    ),
  );
}

function expectFailure<A, E>(
  effect: Effect.Effect<A, E>,
  reason: "MalformedPath" | "NotDirectory" | "NotFound" | "NotRepository",
) {
  return Effect.flip(effect).pipe(
    Effect.tap((error) =>
      Effect.sync(() =>
        expect(error).toEqual({ _tag: "RepositoryPathRejected", reason }),
      ),
    ),
  );
}

function expectMissing<A, E>(effect: Effect.Effect<A, E>) {
  return Effect.flip(effect).pipe(
    Effect.tap((error) =>
      Effect.sync(() =>
        expect(error).toMatchObject({
          _tag: "RepositoryRejected",
          reason: "Missing",
        }),
      ),
    ),
  );
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase catalog "));
  directories.add(directory);
  return realpath(directory);
}
