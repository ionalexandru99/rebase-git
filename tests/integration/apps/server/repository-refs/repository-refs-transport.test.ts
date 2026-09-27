import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  RepositoryBranchesHttpApi,
  RepositoryCatalogHttpApi,
  RepositoryRefsHttpApi,
} from "@rebase/contracts";
import {
  createEnvironmentRequestClient,
  type EnvironmentCredential,
  EnvironmentHttpRejected,
} from "@rebase/environment-client";
import { Effect, Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createRepository, git } from "#tests-support/git";
import { openTestServer } from "#tests-support/server";
import { createBrowserLocalEnvironmentSession } from "#web/app/environment/browser-local-environment-session";
import { connectCurrentEnvironmentEffect } from "#web/app/environment/connection/environment-protocol-client";
import { readRepositoryRefs } from "#web/platform/environment/rpc/read-repository-refs";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repository refs transport", () => {
  it("creates branches and returns typed branch failures", async () => {
    await withRefsServer(async ({ origin, owner, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath, { commits: ["initial", "next"] });
      const remembered = await remember(origin, owner, repositoryPath);
      const head = await git(repositoryPath, "rev-parse", "HEAD");
      const create = {
        name: "spike",
        repositoryId: remembered.id,
        startPoint: head,
        worktreePath: repositoryPath,
      };

      await expect(
        requests(origin, owner)(RepositoryBranchesHttpApi.create, create),
      ).resolves.toEqual({ name: "spike", target: head });
      await git(repositoryPath, "checkout", "spike");
      await git(repositoryPath, "commit", "--allow-empty", "-m", "only here");
      await git(repositoryPath, "checkout", "main");
      const spike = await git(repositoryPath, "rev-parse", "spike");
      await expect(
        requests(origin, owner)(RepositoryBranchesHttpApi.delete, {
          force: false,
          local: { name: "spike", target: spike },
          repositoryId: remembered.id,
          worktreePath: repositoryPath,
        }),
      ).rejects.toMatchObject({
        failure: { _tag: "BranchNotMerged", count: 1, name: "spike" },
      });
    });
  });

  it("reassembles a ref snapshot larger than a WebSocket frame", async () => {
    await withRefsServer(async ({ origin, owner, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath, { branches: ["feature"] });
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
      const repository = await remember(origin, owner, repositoryPath);
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
    await withRefsServer(async ({ origin, owner, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath, { branches: ["feature"] });
      const remembered = await remember(origin, owner, repositoryPath);
      vi.stubGlobal("window", { location: new URL(origin) });
      const runtime = ManagedRuntime.make(Layer.empty);
      const session = createBrowserLocalEnvironmentSession(
        "0.0.0",
        {
          environmentOrigin: origin,
          getEnvironmentCredential: async () => owner.value,
        },
        { runtime },
      );
      const refChanges = countRefChanges(session, remembered.id);
      const refs = () => readConnectedRefs(session, remembered.id);
      session.start();
      try {
        await expect.poll(() => session.getSnapshot()._tag).toBe("Connected");
        await expect
          .poll(async () => (await refs()).branches.map(({ name }) => name))
          .toEqual(["feature", "main"]);

        let seen = refChanges();
        await git(repositoryPath, "branch", "added");
        await git(
          repositoryPath,
          "remote",
          "add",
          "github",
          "git@github.com:alex/rebase.git",
        );
        await git(repositoryPath, "tag", "v1");
        await expect.poll(refChanges).toBeGreaterThan(seen);
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
        seen = refChanges();
        await git(repositoryPath, "fetch", "origin", "--tags");
        await expect.poll(refChanges).toBeGreaterThan(seen);
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

        seen = refChanges();
        await git(repositoryPath, "branch", "-D", "added");
        await git(repositoryPath, "tag", "-d", "v1");
        await git(repositoryPath, "remote", "remove", "origin");
        await expect.poll(refChanges).toBeGreaterThan(seen);
        await expect
          .poll(async () => {
            const current = await refs();
            return {
              branches: current.branches.map(({ name }) => name),
              remotes: current.remoteBranches,
              tags: current.tags.map(({ name }) => name),
            };
          })
          .toEqual({
            branches: ["feature", "main"],
            remotes: [],
            tags: ["fetched-tag"],
          });
      } finally {
        session.stop();
        await runtime.dispose();
      }
    });
  });

  it("serves refs to every paired device and checks out branches", async () => {
    await withRefsServer(async ({ origin, owner, pair, root }) => {
      const repositoryPath = join(root, "repository");
      await createRepository(repositoryPath, { branches: ["feature"] });
      await git(
        repositoryPath,
        "remote",
        "add",
        "origin",
        "git@github.com:alex/rebase.git",
      );
      const viewer = await pair("Second browser");
      const remembered = await remember(origin, owner, repositoryPath);

      const refs = await Effect.runPromise(
        readRefsOverWebSocket(origin, viewer, remembered.id),
      );
      expect(refs.repositoryId).toBe(remembered.id);
      expect(refs.githubRepository).toEqual({ owner: "alex", name: "rebase" });
      expect(refs.branches.map((branch) => branch.name)).toEqual(
        expect.arrayContaining(["main", "feature"]),
      );

      const checkout = {
        repositoryId: remembered.id,
        target: { _tag: "LocalBranch", name: "feature" },
        worktreePath: repositoryPath,
      } as const;
      await expect(
        requests(origin, owner)(RepositoryRefsHttpApi.checkout, checkout),
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
        new EnvironmentHttpRejected({
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
      return yield* Effect.tryPromise({
        try: (signal) =>
          readRepositoryRefs(connection.rpc, repositoryId, signal),
        catch: (error) => error,
      });
    }),
  );
}

function countRefChanges(
  session: ReturnType<typeof createBrowserLocalEnvironmentSession>,
  repositoryId: string,
) {
  let changes = 0;
  session.changes.subscribe((repositoryIds, kind) => {
    if (kind === "Refs" && repositoryIds?.includes(repositoryId)) changes++;
  });
  return () => changes;
}

function readConnectedRefs(
  session: ReturnType<typeof createBrowserLocalEnvironmentSession>,
  repositoryId: string,
) {
  const state = session.getSnapshot();
  if (state._tag !== "Connected")
    return Promise.reject(new Error("The session is not connected."));
  return readRepositoryRefs(
    state.rpc,
    repositoryId,
    new AbortController().signal,
  );
}

interface BearerCredential {
  readonly type: "bearer";
  readonly value: string;
}

async function withRefsServer(
  use: (server: {
    readonly origin: string;
    readonly owner: BearerCredential;
    readonly pair: (label: string) => Promise<BearerCredential>;
    readonly root: string;
  }) => Promise<void>,
) {
  const server = await openTestServer();
  await use({
    origin: server.origin,
    owner: server.owner,
    pair: server.pair,
    root: server.home,
  });
}

function remember(
  origin: string,
  credential: EnvironmentCredential,
  path: string,
) {
  return createEnvironmentRequestClient(origin, () => credential)(
    RepositoryCatalogHttpApi.remember,
    { path },
  );
}

function requests(origin: string, credential: EnvironmentCredential) {
  return createEnvironmentRequestClient(origin, () => credential);
}
