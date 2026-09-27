import { RepositoryCatalogApi } from "@rebase/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { openTestServer } from "#tests-support/server";
import { EnvironmentAccessDenied } from "#web/app/environment/environment-connection";

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

  it("reports an unpaired credential as denied access", async () => {
    const server = await openTestServer();

    await expect(
      server.connect({ type: "bearer", value: "rebase.v1.unpaired" }),
    ).rejects.toEqual(
      new EnvironmentAccessDenied({ failure: { _tag: "InvalidGrant" } }),
    );
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
});
