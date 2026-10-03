import { join } from "node:path";
import { Deferred, Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { RepositoryPullApi } from "#contracts/repository-pull/repository-pull.contract.ts";
import { RepositoryPushApi } from "#contracts/repository-push/repository-push.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { cloneRepository, createRepository, git } from "#tests-support/git.ts";
import { openTestServer } from "#tests-support/server.ts";
import { environmentRequests } from "#web/platform/environment/environment-connection.ts";

const repositoryId = "00000000-0000-4000-8000-000000000001";

describe("browser Environment connection", () => {
  it("invalidates the changed repositories and everything after a missed change", async () => {
    const server = await openTestServer({
      events: (events) => ({
        ...events,
        subscribe: (listener) =>
          events.subscribe((sequence, repositoryIds, kind) => {
            if (sequence === 1) return;
            listener(sequence, repositoryIds, kind);
            listener(sequence, repositoryIds, kind);
          }),
      }),
    });
    const changed = vi.fn();
    await server.connect(server.owner, { changed });

    server.events.publishChanged([repositoryId]);
    server.events.publishChanged([repositoryId]);
    await expect.poll(() => changed.mock.calls).toEqual([[]]);
    server.events.publishChanged([repositoryId], "Refs");
    server.events.publishChanged([repositoryId], "Index");
    await expect
      .poll(() => changed.mock.calls)
      .toEqual([[], [[repositoryId], "Refs"], [[repositoryId], "Index"]]);
  });

  it("answers requests and reports their failures as tagged rejections", async () => {
    const server = await openTestServer();
    const requests = server.requests(server.owner);

    await expect(
      requests(RepositoryCatalogApi.list, undefined),
    ).resolves.toEqual({ repositories: [] });
    await expect(
      requests(RepositoryCatalogApi.recordOpened, { repositoryId }),
    ).rejects.toMatchObject({
      _tag: "Rejected",
      failure: { _tag: "RepositoryRejected", reason: "Missing" },
    });
  });

  it("fails only the request whose handler breaks and keeps the socket serving", async () => {
    const server = await openTestServer({
      git: (git) => ({
        ...git,
        run: (command) =>
          command.arguments.includes("for-each-ref")
            ? Effect.die(new Error("Unreadable refs"))
            : git.run(command),
      }),
    });
    const repositoryPath = join(server.home, "repository");
    await createRepository(repositoryPath);
    const changed = vi.fn();
    const requests = environmentRequests(
      (await server.connect(server.owner, { changed })).rpc,
    );
    const repository = await requests(RepositoryCatalogApi.remember, {
      path: repositoryPath,
    });

    await expect(
      requests(RepositoryRefsApi.read, { repositoryId: repository.id }),
    ).rejects.toEqual({ _tag: "Unanswered" });
    server.events.publishChanged([repository.id], "Index");
    await expect
      .poll(() => changed.mock.calls)
      .toContainEqual([[repository.id], "Index"]);
  });

  it("reports Git progress while a fetch and a push run", async () => {
    const holds = {
      fetch: Effect.runSync(Deferred.make<void>()),
      push: Effect.runSync(Deferred.make<void>()),
    };
    const release = (verb: keyof typeof holds) =>
      Effect.runSync(Deferred.succeed(holds[verb], undefined));
    const server = await openTestServer({
      git: (git) => ({
        ...git,
        run: (command) => {
          const verb = command.arguments[0];
          return verb === "fetch" || verb === "push"
            ? git
                .run(command)
                .pipe(Effect.tap(() => Deferred.await(holds[verb])))
            : git.run(command);
        },
      }),
    });
    const remote = join(server.home, "remote.git");
    const local = join(server.home, "local");
    const other = join(server.home, "other");
    await git(server.home, "init", "--bare", "-b", "main", remote);
    await createRepository(local);
    await git(local, "remote", "add", "origin", remote);
    await git(local, "push", "-u", "origin", "main");
    await cloneRepository(remote, other);
    await git(other, "commit", "--allow-empty", "-m", "theirs");
    await git(other, "push", "origin", "main");
    const requests = server.requests(server.owner);
    const { id } = await requests(RepositoryCatalogApi.remember, {
      path: local,
    });
    const fetched: number[] = [];
    const pushed: number[] = [];

    const fetching = requests(
      RepositoryPullApi.fetch,
      { repositoryId: id },
      { progress: (percent) => fetched.push(percent) },
    );
    await expect.poll(() => fetched.at(-1)).toBeGreaterThan(0);
    release("fetch");
    await fetching;
    await git(local, "merge", "--ff-only", "origin/main");
    await git(local, "commit", "--allow-empty", "-m", "mine");
    const pushing = requests(
      RepositoryPushApi.push,
      {
        repositoryId: id,
        worktreePath: local,
        branch: "main",
        destination: { remote: "origin", branch: "main" },
        setUpstream: false,
        mode: { _tag: "FastForward" },
      },
      { progress: (percent) => pushed.push(percent) },
    );
    await expect.poll(() => pushed.at(-1)).toBe(95);
    release("push");
    await pushing;

    expect(fetched).toEqual(fetched.toSorted((a, b) => a - b));
    expect(pushed).toEqual(pushed.toSorted((a, b) => a - b));
  });
});
