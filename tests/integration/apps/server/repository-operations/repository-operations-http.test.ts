import { join } from "node:path";
import { RepositoryOperationsHttpApi } from "@rebase/contracts";
import { createEnvironmentRequestClient } from "@rebase/environment-client";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";
import { createEnvironmentEventPublisher } from "#server/adapters/environment-transport/events/environment-event-publisher";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { acquireEnvironmentListener } from "#server/app/server/environment-listener";
import { EnvironmentAuthorizationAccess } from "#server/domain/environment-authorization.contract";
import { GitCommands } from "#server/domain/git-command.contract";
import { RepositoryAccess } from "#server/domain/repository-access.contract";
import { RepositoryCoordination } from "#server/domain/repository-coordination.contract";
import {
  createEnvironmentAuthorization,
  environmentAuthorizationFeature,
} from "#server/features/environment-authorization/index";
import { createRepositoryCatalog } from "#server/features/repository-catalog/index";
import { repositoryOperationsFeature } from "#server/features/repository-operations/index";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import {
  createRepositoryAccess,
  createRepositoryCoordination,
} from "#server/repository/access/index";
import { testEnvironmentFeatures } from "#tests-integration/apps/server/environment-connection/test-environment-features";
import {
  createDivergedRepository,
  startConflict,
} from "#tests-support/diverged-repository";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

it("authorizes operation discovery and recovery separately over HTTP", async () => {
  const { directory, git } = await createDivergedRepository();
  try {
    await startConflict(git, "merge");
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* acquireEnvironmentContext(
            environmentPaths(join(directory, ".git", "rebase-test")),
          );
          const authorization = createEnvironmentAuthorization(
            context,
            context.serverSecret,
          );
          const runner = createLocalGitCommandRunner();
          const catalog = createRepositoryCatalog(context, runner);
          const repository = yield* catalog.remember(directory);
          const features = yield* Effect.all([
            environmentAuthorizationFeature,
            repositoryOperationsFeature,
          ]).pipe(
            Effect.provideService(
              EnvironmentAuthorizationAccess,
              authorization,
            ),
            Effect.provideService(
              RepositoryAccess,
              createRepositoryAccess(
                catalog,
                runner,
                createLocalRepositoryWatcher(),
              ),
            ),
            Effect.provideService(GitCommands, runner),
            Effect.provideService(
              RepositoryCoordination,
              createRepositoryCoordination(runner),
            ),
          );
          const listener = yield* acquireEnvironmentListener({
            authorization,
            environmentId: "00000000-0000-4000-8000-000000000001",
            events: createEnvironmentEventPublisher(),
            features: testEnvironmentFeatures(features),
            productVersion: "0.0.0",
          });
          const client = (role: "owner" | "viewer") =>
            Effect.gen(function* () {
              const pairing = yield* authorization.createPairing({
                role,
                capabilities: [],
              });
              const { credential } = yield* authorization.exchangePairing({
                pairingMaterial: pairing.material,
                label: role,
              });
              return createEnvironmentRequestClient(listener.origin, () => ({
                type: "bearer",
                value: credential,
              }))(RepositoryOperationsHttpApi, {
                disconnected: () => {
                  throw new Error("Every request carries a credential.");
                },
                response: (error) => error,
              });
            });
          const viewer = yield* client("viewer");
          const owner = yield* client("owner");
          const scope = {
            repositoryId: repository.id,
            worktreePath: directory,
          };
          const state = yield* viewer.read(scope);
          expect(state.kind).toBe("merge");
          const command = {
            ...scope,
            revision: state.revision,
            action: "abort" as const,
          };
          expect(
            yield* viewer.execute(command).pipe(Effect.flip),
          ).toMatchObject({ status: 403 });
          expect(
            yield* owner
              .read({ ...scope, worktreePath: join(directory, ".git") })
              .pipe(Effect.flip),
          ).toMatchObject({
            status: 404,
            failure: { _tag: "OperationFailed", reason: "Missing" },
          });
          expect((yield* owner.execute(command)).kind).toBe("idle");
        }),
      ),
    );
  } finally {
    await removeTemporaryDirectory(directory);
  }
});
