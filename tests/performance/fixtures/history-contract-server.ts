import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalGitCommandRunner } from "@rebase/server/adapters/local-git/local-git-command-runner";
import type { EnvironmentAuthorization } from "@rebase/server/features/environment-authorization/environment-authorization.contract";
import { createEnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "@rebase/server/features/environment-server/server/environment-listener";
import { createRepositoryCatalog } from "@rebase/server/features/repository-catalog/repository-catalog";
import { createRepositoryHistoryService } from "@rebase/server/features/repository-history/repository-history";
import { acquireEnvironmentContext } from "@rebase/server/persistence/environment-context";
import { environmentPaths } from "@rebase/server/persistence/storage/environment-paths";
import { Effect } from "effect";

const repositoryPath = process.argv[2];
if (repositoryPath === undefined)
  throw new Error("Missing prepared corpus path");
const temporary = await mkdtemp(join(tmpdir(), "rebase-history-contract-"));
const authorization: EnvironmentAuthorization = {
  authorize: () => Effect.succeed(grant()),
  consumeTicket: () => Effect.succeed(grant()),
  createPairing: () => Effect.die("unused"),
  exchangePairing: () => Effect.die("unused"),
  mintTicket: () => Effect.die("unused"),
  revoke: () => Effect.die("unused"),
};
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
try {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const context = yield* acquireEnvironmentContext(
          environmentPaths(temporary),
        );
        const catalog = createRepositoryCatalog(context);
        const repository = yield* catalog.remember(repositoryPath);
        const listener = yield* acquireEnvironmentListener({
          authorization,
          catalog,
          environmentId: crypto.randomUUID(),
          events: createEnvironmentEventPublisher(),
          history: createRepositoryHistoryService({
            catalog,
            git: createLocalGitCommandRunner(),
          }),
          productVersion: "0.0.0",
        });
        listener.readiness.value = true;
        yield* Effect.sync(() => {
          globalThis.gc?.();
          process.stdout.write(
            `${JSON.stringify({ origin: listener.origin, repositoryId: repository.id, idleRssBytes: process.memoryUsage().rss })}\n`,
          );
        });
        yield* Effect.never;
      }),
    ),
    { signal: controller.signal },
  ).catch((error) => {
    if (!controller.signal.aborted) throw error;
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}

function grant() {
  return {
    capabilities: ["environment.read", "repository.read"] as const,
    id: "00000000-0000-4000-8000-000000000002",
    label: "History contract fixture",
    role: "custom" as const,
  };
}
