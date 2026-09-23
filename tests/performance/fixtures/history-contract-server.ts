import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/events/environment-event-publisher";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { environmentFeatures } from "#server/app/server/environment-features";
import { acquireEnvironmentListener } from "#server/app/server/environment-listener";
import {
  type EnvironmentAuthorization,
  EnvironmentAuthorizationAccess,
} from "#server/domain/environment-authorization.contract";
import { EnvironmentEvents } from "#server/domain/environment-event-publisher.contract";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import { RepositoryCatalogAccess } from "#server/domain/repository-catalog.contract";
import { RepositoryCoordination } from "#server/domain/repository-coordination.contract";
import { RepositoryWatching } from "#server/domain/repository-watcher.contract";
import { createRepositoryCatalog } from "#server/features/repository-catalog/index";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import {
  createRepositoryAccess,
  createRepositoryCoordination,
} from "#server/repository/access/index";

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
        const git = createLocalGitCommandRunner();
        const catalog = createRepositoryCatalog(context, git);
        const repository = yield* catalog.remember(repositoryPath);
        const events = createEnvironmentEventPublisher();
        const features = yield* environmentFeatures.pipe(
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
          environmentId: crypto.randomUUID(),
          events,
          features,
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
