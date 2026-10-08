import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import {
  DiagnosticsApi,
  type DiagnosticsEvent,
  type DiagnosticsSample,
} from "#contracts/diagnostics/diagnostics.contract.ts";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { RepositoryRefsApi } from "#contracts/repository-refs/repository-refs.contract.ts";
import { createRepository } from "#tests-support/git.ts";
import { openTestServer } from "#tests-support/server.ts";
import { environmentSubscriptions } from "#web/platform/environment/environment-connection.ts";

it("samples the server's processes through the bundled monitor and records Git runs per repository", async () => {
  const server = await openTestServer();
  const worktreePath = join(server.home, "repository");
  await createRepository(worktreePath);
  const requests = server.requests(server.owner);
  const subscribe = environmentSubscriptions(
    (await server.connect(server.owner)).rpc,
  );
  const events: DiagnosticsEvent[] = [];
  const watching = new AbortController();
  const watched = subscribe(
    DiagnosticsApi.watch,
    { period: "5m" },
    (event) => events.push(event),
    watching.signal,
  );

  const { id: repositoryId } = await requests(RepositoryCatalogApi.remember, {
    path: worktreePath,
  });
  await requests(RepositoryRefsApi.read, { repositoryId });

  const latest = () =>
    events.findLast(
      (event): event is DiagnosticsSample => event._tag === "Sample",
    );
  await expect
    .poll(() => latest()?.processes.map(({ kind }) => kind) ?? [])
    .toEqual(expect.arrayContaining(["Server", "Monitor"]));
  await expect
    .poll(() => latest()?.slowestRequests ?? [])
    .toContainEqual(
      expect.objectContaining({ name: "repositories/refs/read", repositoryId }),
    );
  expect(events[0]).toEqual({ _tag: "Errors", errors: [] });
  expect(latest()).toMatchObject({
    monitor: { _tag: "Running" },
    footprint: { processes: expect.any(Number) },
    server: {
      platform: process.platform,
      dataFolder: join(server.home, ".rebase"),
    },
  });
  expect(latest()?.footprint.memory).toBeGreaterThan(0);
  expect(
    latest()?.slowestGit.some((run) => run.repositoryId === repositoryId),
  ).toBe(true);

  watching.abort();
  await expect(watched).rejects.toMatchObject({ _tag: "Cancelled" });
});
