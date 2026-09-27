import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { createRepository, git } from "#tests-support/git.ts";
import { openTestServer } from "#tests-support/server.ts";
import { createBrowserLocalEnvironmentSession } from "#web/app/environment/browser-local-environment-session.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("repository refs transport", () => {
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
    let changes = 0;
    const session = createBrowserLocalEnvironmentSession(
      {
        environmentOrigin: origin,
        getEnvironmentCredential: async () => owner.value,
      },
      {
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
    }
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
