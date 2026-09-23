import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/events/environment-event-publisher";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { acquireEnvironmentListener } from "#server/app/server/environment-listener";
import {
  type EnvironmentAuthorization,
  EnvironmentAuthorizationAccess,
} from "#server/domain/environment-authorization.contract";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import { RepositoryCatalogAccess } from "#server/domain/repository-catalog.contract";
import { environmentAuthorizationFeature } from "#server/features/environment-authorization/index";
import {
  createRepositoryCatalog,
  repositoryCatalogFeature,
} from "#server/features/repository-catalog/index";
import { repositoryHistoryFeature } from "#server/features/repository-history/index";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import { createRepositoryAccess } from "#server/repository/access/index";

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
        const features = yield* Effect.all([
          environmentAuthorizationFeature,
          repositoryCatalogFeature,
          repositoryHistoryFeature,
        ]).pipe(
          Effect.provideService(EnvironmentAuthorizationAccess, authorization),
          Effect.provideService(RepositoryCatalogAccess, catalog),
          Effect.provideService(
            RepositoryAccess,
            createRepositoryAccess(catalog, git),
          ),
          Effect.provideService(GitCommands, git),
        );
        const listener = yield* acquireEnvironmentListener({
          authorization,
          environmentId: crypto.randomUUID(),
          events: createEnvironmentEventPublisher(),
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
