import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  RepositoryBranchesApi,
  RepositoryCatalogApi,
  RepositoryRefsApi,
} from "@rebase/contracts";
import { Layer, ManagedRuntime } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createRepository, git } from "#tests-support/git";
import { openTestServer } from "#tests-support/server";
import { createBrowserLocalEnvironmentSession } from "#web/app/environment/browser-local-environment-session";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repository refs transport", () => {
  it("creates branches and returns typed branch failures", async () => {
    const server = await openTestServer();
    const requests = server.requests(server.owner);
    const repositoryPath = join(server.home, "repository");
    await createRepository(repositoryPath, { commits: ["initial", "next"] });
    const remembered = await requests(RepositoryCatalogApi.remember, {
      path: repositoryPath,
    });
    const head = await git(repositoryPath, "rev-parse", "HEAD");
    const create = {
      name: "spike",
      repositoryId: remembered.id,
      startPoint: head,
      worktreePath: repositoryPath,
    };

    await expect(
      requests(RepositoryBranchesApi.create, create),
    ).resolves.toEqual({ name: "spike", target: head });
    await git(repositoryPath, "checkout", "spike");
    await git(repositoryPath, "commit", "--allow-empty", "-m", "only here");
    await git(repositoryPath, "checkout", "main");
    const spike = await git(repositoryPath, "rev-parse", "spike");
    await expect(
      requests(RepositoryBranchesApi.delete, {
        force: false,
        local: { name: "spike", target: spike },
        repositoryId: remembered.id,
        worktreePath: repositoryPath,
      }),
    ).rejects.toMatchObject({
      failure: { _tag: "BranchNotMerged", count: 1, name: "spike" },
    });
  });

  it("reads a ref snapshot larger than a megabyte", async () => {
    const server = await openTestServer();
    const repositoryPath = join(server.home, "repository");
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
    const repository = await server.requests(server.owner)(
      RepositoryCatalogApi.remember,
      { path: repositoryPath },
    );
    const refs = await server.requests(server.owner)(RepositoryRefsApi.read, {
      repositoryId: repository.id,
    });
    expect(refs.remoteBranches.map((branch) => branch.name)).toEqual(names);
    expect(refs.tags.map((tag) => tag.name)).toEqual(["v1"]);
    expect(refs.truncated).toEqual({
      branches: false,
      remoteBranches: false,
      tags: false,
    });
  });

  it("automatically updates the client refs after filesystem changes and fetches", async () => {
    const server = await openTestServer();
    const { origin, owner } = server;
    const repositoryPath = join(server.home, "repository");
    await createRepository(repositoryPath, { branches: ["feature"] });
    const remembered = await server.requests(owner)(
      RepositoryCatalogApi.remember,
      { path: repositoryPath },
    );
    vi.stubGlobal("window", { location: new URL(origin) });
    const runtime = ManagedRuntime.make(Layer.empty);
    let changes = 0;
    const session = createBrowserLocalEnvironmentSession(
      {
        environmentOrigin: origin,
        getEnvironmentCredential: async () => owner.value,
      },
      {
        runtime,
        invalidation: {
          changed: (repositoryIds, kind) => {
            if (kind === "Refs" && repositoryIds?.includes(remembered.id))
              changes++;
          },
        },
      },
    );
    const refChanges = () => changes;
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

      const remotePath = join(server.home, "remote");
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

  it("serves refs to every paired device and checks out branches", async () => {
    const server = await openTestServer();
    const { owner } = server;
    const requests = server.requests(owner);
    const repositoryPath = join(server.home, "repository");
    await createRepository(repositoryPath, { branches: ["feature"] });
    await git(
      repositoryPath,
      "remote",
      "add",
      "origin",
      "git@github.com:alex/rebase.git",
    );
    const viewer = await server.pair("Second browser");
    const remembered = await requests(RepositoryCatalogApi.remember, {
      path: repositoryPath,
    });

    const refs = await server.requests(viewer)(RepositoryRefsApi.read, {
      repositoryId: remembered.id,
    });
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
      requests(RepositoryRefsApi.checkout, checkout),
    ).resolves.toMatchObject({ head: { branch: "feature" }, stash: "none" });
    await expect(
      server.requests(viewer)(RepositoryRefsApi.read, {
        repositoryId: "00000000-0000-4000-8000-000000000099",
      }),
    ).rejects.toEqual({
      _tag: "Rejected",
      failure: {
        _tag: "RepositoryRejected",
        reason: "Missing",
        detail: "This repository is no longer available.",
      },
    });
  });
});

function readConnectedRefs(
  session: ReturnType<typeof createBrowserLocalEnvironmentSession>,
  repositoryId: string,
) {
  const state = session.getSnapshot();
  if (state._tag !== "Connected")
    return Promise.reject(new Error("The session is not connected."));
  return state.requests(RepositoryRefsApi.read, { repositoryId });
}
