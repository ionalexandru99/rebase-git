import { join } from "node:path";
import { RepositoryCatalogApi, RepositoryRefsApi } from "@rebase/contracts";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import { createRepository } from "#tests-support/git";
import { openTestServer } from "#tests-support/server";
import { environmentRequests } from "#web/app/environment/environment-connection";

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
});
