import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEnvironmentRequestClient,
  type EnvironmentCredential,
} from "@rebase/environment-client";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/events/environment-event-publisher";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { acquireEnvironmentListener } from "#server/app/server/environment-listener";
import { EnvironmentAuthorizationAccess } from "#server/domain/environment-authorization.contract";
import { EnvironmentEvents } from "#server/domain/environment-event-publisher.contract";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import { RepositoryCatalogAccess } from "#server/domain/repository-catalog.contract";
import { RepositoryCoordination } from "#server/domain/repository-coordination.contract";
import { RepositoryWatching } from "#server/domain/repository-watcher.contract";
import {
  createEnvironmentAuthorization,
  environmentAuthorizationFeature,
} from "#server/features/environment-authorization/index";
import {
  createRepositoryCatalog,
  repositoryCatalogFeature,
} from "#server/features/repository-catalog/index";
import { repositoryRefsFeature } from "#server/features/repository-refs/index";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import {
  createRepositoryAccess,
  createRepositoryCoordination,
} from "#server/repository/access/index";
import { testEnvironmentFeatures } from "#tests-integration/apps/server/environment-connection/test-environment-features";
import { createRepository, git } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";
import { createBrowserLocalEnvironmentSession } from "#web/app/environment/browser-local-environment-session";
import {
  connectCurrentEnvironmentEffect,
  exchangeEnvironmentPairingEffect,
} from "#web/app/environment/connection/index";
import {
  RepositoryBranchesRejected,
  repositoryBranchesClient,
} from "#web/features/branch-management/index";
import { repositoryCatalogClient } from "#web/features/repository-catalog/index";
import {
  RepositoryRefsRejected,
  repositoryRefsClient,
} from "#web/features/repository-refs/index";
import { createRepositoryRefsRpc } from "#web/features/repository-refs/transport/repository-refs-rpc";

const directories = new Set<string>();
const environmentId = "00000000-0000-4000-8000-000000000001";

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) => removeTemporaryDirectory(directory)),
  );
  directories.clear();
  vi.unstubAllGlobals();
});

describe("repository refs transport", () => {
  it("reserves branch writes for writers and returns typed branch failures", async () => {
    await withRefsListener(async ({ authorization, origin, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath, { commits: ["initial", "next"] });
      const owner = await pair(origin, authorization, "owner");
      const viewer = await pair(origin, authorization, "viewer");
      const remembered = await Effect.runPromise(
        remember(origin, owner, repositoryPath),
      );
      const head = await git(repositoryPath, "rev-parse", "HEAD");
      const create = {
        name: "spike",
        repositoryId: remembered.id,
        startPoint: head,
        worktreePath: repositoryPath,
      };

      await expect(
        Effect.runPromise(branchesClient(origin, viewer).create(create)),
      ).rejects.toEqual(
        new RepositoryBranchesRejected({
          failure: { _tag: "CapabilityDenied", capability: "repository.write" },
        }),
      );
      await expect(
        Effect.runPromise(branchesClient(origin, owner).create(create)),
      ).resolves.toEqual({ name: "spike", target: head });
      await git(repositoryPath, "checkout", "spike");
      await git(repositoryPath, "commit", "--allow-empty", "-m", "only here");
      await git(repositoryPath, "checkout", "main");
      const spike = await git(repositoryPath, "rev-parse", "spike");
      await expect(
        Effect.runPromise(
          branchesClient(origin, owner).delete({
            force: false,
            local: { name: "spike", target: spike },
            repositoryId: remembered.id,
            worktreePath: repositoryPath,
          }),
        ),
      ).rejects.toMatchObject({
        failure: { _tag: "BranchNotMerged", count: 1, name: "spike" },
      });
    });
  });

  it("reassembles a ref snapshot larger than a WebSocket frame", async () => {
    await withRefsListener(async ({ authorization, origin, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath, { branches: ["feature"] });
      const owner = await pair(origin, authorization, "owner");
      const head = await git(repositoryPath, "rev-parse", "HEAD");
      const names = Array.from(
        { length: 8_000 },
        (_, index) =>
          `branch-${index.toString().padStart(5, "0")}-${"x".repeat(140)}`,
      );
      await writeFile(
        join(repositoryPath, ".git", "packed-refs"),
        names.map((name) => `${head} refs/remotes/origin/${name}\n`).join(""),
      );
      await git(repositoryPath, "tag", "v1");
      const repository = await Effect.runPromise(
        remember(origin, owner, repositoryPath),
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

  it("automatically updates the client refs after filesystem changes and fetches", async () => {
    await withRefsListener(async ({ authorization, origin, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath, { branches: ["feature"] });
      const owner = await pair(origin, authorization, "owner");
      const remembered = await Effect.runPromise(
        remember(origin, owner, repositoryPath),
      );
      vi.stubGlobal("window", { location: new URL(origin) });
      const session = createBrowserLocalEnvironmentSession("0.0.0", {
        environmentOrigin: origin,
        getEnvironmentCredential: async () => owner.value,
      });
      const refs = () => session.repositoryRefs.getSnapshot().refs;
      session.start();
      try {
        await expect.poll(() => session.getSnapshot()._tag).toBe("Connected");
        session.repositoryRefs.select(remembered.id);
        await expect
          .poll(() => refs()?.branches.map((branch) => branch.name))
          .toEqual(["feature", "main"]);

        await git(repositoryPath, "branch", "added");
        await git(
          repositoryPath,
          "remote",
          "add",
          "github",
          "git@github.com:alex/rebase.git",
        );
        await git(repositoryPath, "tag", "v1");
        await expect.poll(refs).toMatchObject({
          branches: expect.arrayContaining([
            { name: "added", target: expect.any(String) },
          ]),
          remoteProviders: [{ remote: "github", provider: "github" }],
          tags: [{ name: "v1", target: expect.any(String) }],
        });

        const remotePath = join(root, "remote");
        await createRepository(remotePath, { branches: ["feature"] });
        await git(remotePath, "branch", "fetched-branch");
        await git(remotePath, "tag", "fetched-tag");
        await git(repositoryPath, "remote", "add", "origin", remotePath);
        await git(repositoryPath, "fetch", "origin", "--tags");
        await expect.poll(refs).toMatchObject({
          remoteBranches: expect.arrayContaining([
            {
              name: "fetched-branch",
              remote: "origin",
              target: expect.any(String),
            },
          ]),
          tags: expect.arrayContaining([
            { name: "fetched-tag", target: expect.any(String) },
          ]),
        });

        await git(repositoryPath, "branch", "-D", "added");
        await git(repositoryPath, "tag", "-d", "v1");
        await git(repositoryPath, "remote", "remove", "origin");
        await expect
          .poll(() => ({
            branches: refs()?.branches.map((branch) => branch.name),
            remotes: refs()?.remoteBranches,
            tags: refs()?.tags.map((tag) => tag.name),
          }))
          .toEqual({
            branches: ["feature", "main"],
            remotes: [],
            tags: ["fetched-tag"],
          });
      } finally {
        session.stop();
      }
    });
  });

  it("serves refs to readers and reserves checkout for writers", async () => {
    await withRefsListener(async ({ authorization, origin, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath, { branches: ["feature"] });
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
        remember(origin, owner, repositoryPath),
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
          refsClient(origin, viewer).checkout({
            repositoryId: remembered.id,
            target: { _tag: "LocalBranch", name: "feature" },
            worktreePath: repositoryPath,
          }),
        ),
      ).rejects.toEqual(
        new RepositoryRefsRejected({
          failure: { _tag: "CapabilityDenied", capability: "repository.write" },
        }),
      );
      await expect(
        Effect.runPromise(
          refsClient(origin, owner).checkout({
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
            _tag: "RepositoryRejected",
            reason: "Missing",
            detail: "This repository is no longer available.",
          },
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
      return yield* createRepositoryRefsRpc(connection).read(repositoryId);
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
        const catalog = createRepositoryCatalog(
          context,
          createLocalGitCommandRunner(),
        );
        const events = createEnvironmentEventPublisher();
        const git = createLocalGitCommandRunner();
        const features = yield* Effect.all([
          environmentAuthorizationFeature,
          repositoryCatalogFeature,
          repositoryRefsFeature,
        ]).pipe(
          Effect.provideService(EnvironmentAuthorizationAccess, authorization),
          Effect.provideService(RepositoryCatalogAccess, catalog),
          Effect.provideService(
            RepositoryAccess,
            createRepositoryAccess(
              catalog,
              git,
              createLocalRepositoryWatcher(),
            ),
          ),
          Effect.provideService(GitCommands, git),
          Effect.provideService(
            RepositoryCoordination,
            createRepositoryCoordination(git),
          ),
          Effect.provideService(
            RepositoryWatching,
            createLocalRepositoryWatcher(),
          ),
          Effect.provideService(EnvironmentEvents, events),
        );
        const listener = yield* acquireEnvironmentListener({
          authorization,
          environmentId,
          events,
          features: testEnvironmentFeatures(features),
          productVersion: "0.0.0",
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
  const exchanged = await Effect.runPromise(
    exchangeEnvironmentPairingEffect(origin, {
      label: `${role} browser`,
      pairingMaterial: pairing.material,
    }),
  );
  return { type: "bearer" as const, value: exchanged.credential };
}

function remember(
  origin: string,
  credential: EnvironmentCredential,
  path: string,
) {
  return repositoryCatalogClient(
    createEnvironmentRequestClient(origin, () => credential),
  ).remember({ path });
}

function branchesClient(origin: string, credential: EnvironmentCredential) {
  return repositoryBranchesClient(
    createEnvironmentRequestClient(origin, () => credential),
  );
}

function refsClient(origin: string, credential: EnvironmentCredential) {
  return repositoryRefsClient(
    createEnvironmentRequestClient(origin, () => credential),
  );
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
