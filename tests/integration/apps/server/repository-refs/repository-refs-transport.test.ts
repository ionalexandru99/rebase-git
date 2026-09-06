import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  connectCurrentEnvironmentEffect,
  exchangeEnvironmentPairing,
} from "@rebase/web/features/environment-connection";
import { rememberEnvironmentRepositoryEffect } from "@rebase/web/features/repository-catalog";
import {
  checkoutRepositoryRefEffect,
  RepositoryRefsRejected,
} from "@rebase/web/features/repository-refs";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { createEnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "#server/features/environment-server/server/environment-listener";
import { createRepositoryCatalog } from "#server/features/repository-catalog/repository-catalog";
import { acquireRepositoryChangePublisher } from "#server/features/repository-refs/repository-change-publisher";
import { createRepositoryRefsService } from "#server/features/repository-refs/repository-refs";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";

const execFilePromise = promisify(execFile);
const directories = new Set<string>();
const environmentId = "00000000-0000-4000-8000-000000000001";

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  directories.clear();
});

describe("repository refs transport", () => {
  it("reassembles a ref snapshot larger than a WebSocket frame", async () => {
    await withRefsListener(async ({ authorization, origin, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath);
      const owner = await pair(origin, authorization, "owner");
      const { stdout } = await execFilePromise("git", [
        "-C",
        repositoryPath,
        "rev-parse",
        "HEAD",
      ]);
      const names = Array.from(
        { length: 8_000 },
        (_, index) =>
          `branch-${index.toString().padStart(5, "0")}-${"x".repeat(140)}`,
      );
      await writeFile(
        join(repositoryPath, ".git", "packed-refs"),
        names
          .map((name) => `${stdout.trim()} refs/remotes/origin/${name}\n`)
          .join(""),
      );
      await git(repositoryPath, "tag", "v1");
      const repository = await Effect.runPromise(
        rememberEnvironmentRepositoryEffect(origin, owner, repositoryPath),
      );
      const refs = await Effect.runPromise(
        readRefsOverWebSocket(origin, owner, repository.id),
      );
      expect(refs.remoteBranches.map((branch) => branch.name)).toEqual(names);
      expect(refs.tags.map((tag) => tag.name)).toEqual(["v1"]);
      expect(refs.truncated).toEqual({
        branches: false,
        remoteBranches: false,
        tags: false,
      });
    });
  });

  it("reads branches, remotes and tags over the live connection after Git changes", async () => {
    await withRefsListener(async ({ authorization, origin, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath);
      const owner = await pair(origin, authorization, "owner");
      const remembered = await Effect.runPromise(
        rememberEnvironmentRepositoryEffect(origin, owner, repositoryPath),
      );
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* connectCurrentEnvironmentEffect(
              origin,
              "0.0.0",
              { credential: owner },
            );
            const initial = yield* connection.repositoryRefs.read(
              remembered.id,
            );
            expect(initial.branches.map((branch) => branch.name)).toEqual([
              "feature",
              "main",
            ]);
            const sequence = connection.currentSequence();
            yield* Effect.promise(async () => {
              await git(repositoryPath, "branch", "added");
              await git(
                repositoryPath,
                "remote",
                "add",
                "origin",
                "git@github.com:alex/rebase.git",
              );
              await git(
                repositoryPath,
                "update-ref",
                "refs/remotes/origin/main",
                "HEAD",
              );
              await git(repositoryPath, "tag", "v1");
            });
            yield* connection
              .waitForSequence(sequence + 1)
              .pipe(Effect.timeout(5_000));
            const updated = yield* connection.repositoryRefs.read(
              remembered.id,
            );
            expect(updated.branches.map((branch) => branch.name)).toContain(
              "added",
            );
            expect(updated.remoteBranches).toMatchObject([
              { remote: "origin", name: "main" },
            ]);
            expect(updated.remoteProviders).toEqual([
              { remote: "origin", provider: "github" },
            ]);
            expect(updated.tags.map((tag) => tag.name)).toEqual(["v1"]);
          }),
        ),
      );
    });
  });

  it("serves refs to readers and reserves checkout for writers", async () => {
    await withRefsListener(async ({ authorization, origin, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath);
      await git(
        repositoryPath,
        "remote",
        "add",
        "origin",
        "git@github.com:alex/rebase.git",
      );
      const owner = await pair(origin, authorization, "owner");
      const viewer = await pair(origin, authorization, "viewer");
      const remembered = await Effect.runPromise(
        rememberEnvironmentRepositoryEffect(origin, owner, repositoryPath),
      );

      const refs = await Effect.runPromise(
        readRefsOverWebSocket(origin, viewer, remembered.id),
      );
      expect(refs.repositoryId).toBe(remembered.id);
      expect(refs.githubRepository).toEqual({ owner: "alex", name: "rebase" });
      expect(refs.branches.map((branch) => branch.name)).toEqual(
        expect.arrayContaining(["main", "feature"]),
      );

      await expect(
        Effect.runPromise(
          checkoutRepositoryRefEffect(origin, viewer, {
            repositoryId: remembered.id,
            target: { _tag: "LocalBranch", name: "feature" },
            worktreePath: repositoryPath,
          }),
        ),
      ).rejects.toEqual(
        new RepositoryRefsRejected({
          failure: { _tag: "CapabilityDenied", capability: "repository.write" },
          status: 403,
        }),
      );
      await expect(
        Effect.runPromise(
          checkoutRepositoryRefEffect(origin, owner, {
            repositoryId: remembered.id,
            target: { _tag: "LocalBranch", name: "feature" },
            worktreePath: repositoryPath,
          }),
        ),
      ).resolves.toMatchObject({ head: { branch: "feature" }, stash: "none" });
      await expect(
        Effect.runPromise(
          readRefsOverWebSocket(
            origin,
            viewer,
            "00000000-0000-4000-8000-000000000099",
          ),
        ),
      ).rejects.toEqual(
        new RepositoryRefsRejected({
          failure: {
            _tag: "RepositoryMissing",
            repositoryId: "00000000-0000-4000-8000-000000000099",
          },
          status: 404,
        }),
      );
    });
  });
});

function readRefsOverWebSocket(
  origin: string,
  credential: { readonly type: "bearer"; readonly value: string },
  repositoryId: string,
) {
  return Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* connectCurrentEnvironmentEffect(
        origin,
        "0.0.0",
        { credential },
      );
      return yield* connection.repositoryRefs.read(repositoryId);
    }),
  );
}

function withRefsListener(use: (fixture: ListenerFixture) => Promise<void>) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.promise(createTemporaryDirectory);
        const context = yield* acquireEnvironmentContext(
          environmentPaths(join(root, ".rebase")),
        );
        const authorization = createEnvironmentAuthorization(
          context,
          context.serverSecret,
        );
        const catalog = createRepositoryCatalog(context);
        const events = createEnvironmentEventPublisher();
        const git = createLocalGitCommandRunner();
        const listener = yield* acquireEnvironmentListener({
          authorization,
          catalog,
          environmentId,
          events,
          productVersion: "0.0.0",
          refs: createRepositoryRefsService({
            catalog,
            changes: yield* acquireRepositoryChangePublisher(
              git,
              createLocalRepositoryWatcher(),
              events,
            ),
            git,
          }),
        });
        listener.readiness.value = true;
        yield* Effect.promise(() =>
          use({ authorization, origin: listener.origin, root }),
        );
      }),
    ),
  );
}

async function pair(
  origin: string,
  authorization: ReturnType<typeof createEnvironmentAuthorization>,
  role: "owner" | "viewer",
) {
  const pairing = await Effect.runPromise(
    authorization.createPairing({ capabilities: [], role }),
  );
  const exchanged = (
    await exchangeEnvironmentPairing(origin, {
      label: `${role} browser`,
      pairingMaterial: pairing.material,
    })
  ).credential;
  return { type: "bearer" as const, value: exchanged };
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
  await git(path, "branch", "feature");
}

async function git(path: string, ...arguments_: string[]) {
  await execFilePromise("git", ["-C", path, ...arguments_]);
}

async function createTemporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "rebase refs transport "));
  directories.add(directory);
  return realpath(directory);
}

interface ListenerFixture {
  readonly authorization: ReturnType<typeof createEnvironmentAuthorization>;
  readonly origin: string;
  readonly root: string;
}
