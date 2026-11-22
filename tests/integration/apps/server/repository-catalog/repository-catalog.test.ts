import { access, mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import {
  type GitCommandRunner,
  gitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import { createRepositoryCatalog } from "#server/features/repository-catalog/repository-catalog.ts";
import { repositoryCatalogTable } from "#server/persistence/environment-state.schema.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory.ts";

describe("repository catalog", () => {
  it("reports unavailable Git without remembering the path", async () => {
    const root = await createTemporaryDirectory();
    const unavailable: GitCommandRunner = {
      run: () => Promise.reject(gitFailed("GitUnavailable")),
      stream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(gitFailed("GitUnavailable")),
        }),
      }),
    };
    const { catalog } = await catalogEnvironment(unavailable);

    await expect(catalog.remember(root)).rejects.toMatchObject({
      reason: "InspectionFailed",
    });
    expect(await catalog.list()).toEqual([]);
  });

  it("remembers one canonical worktree root and keeps its identity stable", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "projects", "rebase git");
    const nestedPath = join(repositoryPath, "src", "nested");
    await createRepository(repositoryPath);
    await mkdir(nestedPath, { recursive: true });
    const { catalog } = await catalogEnvironment();

    const first = await catalog.remember(nestedPath);
    const second = await catalog.remember(repositoryPath);

    expect(first).toMatchObject({ name: "rebase git", path: repositoryPath });
    expect(first.id).toBe(second.id);
    expect(first.addedAt).toBe(second.addedAt);
    expect(await catalog.list()).toEqual([second]);
  });

  it("keeps linked worktrees as distinct repository entries", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "main");
    const worktreePath = join(root, "feature worktree");
    await createRepository(repositoryPath);
    await git(repositoryPath, "worktree", "add", worktreePath, "-b", "feature");
    const { catalog } = await catalogEnvironment();

    await catalog.remember(repositoryPath);
    await catalog.remember(worktreePath);
    const repositories = await catalog.list();

    expect(repositories.map(({ name, path }) => ({ name, path }))).toEqual([
      { name: "feature worktree", path: worktreePath },
      { name: "main", path: repositoryPath },
    ]);
    expect(repositories[0]?.logicalRepositoryId).toBe(
      repositories[1]?.logicalRepositoryId,
    );
    expect(repositories[0]?.color).toBe(repositories[1]?.color);
  });

  it("gives each new repository the color fewest repositories use", async () => {
    const root = await createTemporaryDirectory();
    const first = join(root, "first");
    const second = join(root, "second");
    const third = join(root, "third");
    const fourth = join(root, "fourth");
    await Promise.all(
      [first, second, third, fourth].map((path) => createRepository(path)),
    );
    const { catalog } = await catalogEnvironment();

    const blue = await catalog.remember(first);
    const green = await catalog.remember(second);
    const violet = await catalog.remember(third);
    await catalog.remove(green.id);
    const reused = await catalog.remember(fourth);
    const reopened = await catalog.remember(first);

    expect(
      [blue, green, violet, reused, reopened].map(({ color }) => color),
    ).toEqual(["blue", "green", "violet", "green", "blue"]);
  });

  it("creates a new logical identity after the last catalog entry is removed", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "repository");
    await createRepository(repositoryPath);
    const { catalog } = await catalogEnvironment();

    const first = await catalog.remember(repositoryPath);
    await catalog.remove(first.id);
    const second = await catalog.remember(repositoryPath);

    expect(second.logicalRepositoryId).not.toBe(first.logicalRepositoryId);
  });

  it("repairs linked-worktree identities created before the identity migration", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "main");
    const worktreePath = join(root, "feature");
    await createRepository(repositoryPath);
    await git(repositoryPath, "worktree", "add", worktreePath, "-b", "feature");
    const { catalog, context } = await catalogEnvironment();
    const main = await catalog.remember(repositoryPath);
    const feature = await catalog.remember(worktreePath);
    await context.write("Could not simulate legacy catalog", (database) =>
      database
        .update(repositoryCatalogTable)
        .set({ gitCommonDirectory: null, logicalRepositoryId: null }),
    );
    await context.write("Could not simulate legacy color", (database) =>
      database
        .update(repositoryCatalogTable)
        .set({ color: "red" })
        .where(eq(repositoryCatalogTable.id, feature.id)),
    );

    const repairedFeature = await catalog.find(feature.id);
    const repairedMain = await catalog.find(main.id);

    expect(repairedFeature?.logicalRepositoryId).toBeDefined();
    expect(repairedFeature?.logicalRepositoryId).toBe(
      repairedMain?.logicalRepositoryId,
    );
    expect(repairedFeature?.color).toBe(repairedMain?.color);
  });

  it("records an open and removes only the catalog entry", async () => {
    const root = await createTemporaryDirectory();
    const repositoryPath = join(root, "repository");
    await createRepository(repositoryPath);
    const { catalog } = await catalogEnvironment();
    const remembered = await catalog.remember(repositoryPath);

    const opened = await catalog.recordOpened(remembered.id);
    const removed = await catalog.remove(remembered.id);

    expect(opened.lastOpenedAt >= opened.addedAt).toBe(true);
    expect(removed.repositoryId).toBe(opened.id);
    expect(await catalog.list()).toEqual([]);
    await expect(access(repositoryPath)).resolves.toBeUndefined();
  });

  it("rejects malformed, missing, non-directory, and non-repository paths", async () => {
    const root = await createTemporaryDirectory();
    const plainDirectory = join(root, "plain");
    const plainFile = join(root, "plain-file");
    await mkdir(plainDirectory);
    await writeFile(plainFile, "plain", "utf8");
    const { catalog } = await catalogEnvironment();
    const rejected = (reason: string) => ({
      _tag: "RepositoryPathRejected",
      reason,
    });

    await expect(catalog.remember("relative")).rejects.toEqual(
      rejected("MalformedPath"),
    );
    await expect(catalog.remember(join(root, "missing"))).rejects.toEqual(
      rejected("NotFound"),
    );
    await expect(catalog.remember(plainFile)).rejects.toEqual(
      rejected("NotDirectory"),
    );
    await expect(catalog.remember(plainDirectory)).rejects.toEqual(
      rejected("NotRepository"),
    );
  });

  it("reports missing repository ids for open and remove", async () => {
    const missingId = "00000000-0000-4000-8000-000000000099";
    const { catalog } = await catalogEnvironment();
    const missing = { _tag: "RepositoryRejected", reason: "Missing" };

    await expect(catalog.recordOpened(missingId)).rejects.toMatchObject(
      missing,
    );
    await expect(catalog.remove(missingId)).rejects.toMatchObject(missing);
  });
});

async function catalogEnvironment(git?: GitCommandRunner) {
  const environment = await openTestEnvironment();
  return {
    catalog:
      git === undefined
        ? environment.catalog
        : createRepositoryCatalog(environment.context, git),
    context: environment.context,
  };
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase catalog "));
  onTestFinished(() => removeTemporaryDirectory(directory));
  return realpath(directory);
}
