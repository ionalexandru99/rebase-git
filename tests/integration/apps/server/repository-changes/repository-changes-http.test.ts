import { mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CommitInspectionHttpApi,
  RepositoryChangesHttpApi,
} from "@rebase/contracts";
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
import { commitInspectionFeature } from "#server/features/commit-inspection/index";
import {
  createEnvironmentAuthorization,
  environmentAuthorizationFeature,
} from "#server/features/environment-authorization/index";
import { createRepositoryCatalog } from "#server/features/repository-catalog/index";
import { repositoryChangesFeature } from "#server/features/repository-changes/index";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import {
  createRepositoryAccess,
  createRepositoryCoordination,
} from "#server/repository/access/index";
import { bearerRequests } from "#tests-integration/apps/server/environment-connection/bearer-requests";
import { testEnvironmentFeatures } from "#tests-integration/apps/server/environment-connection/test-environment-features";
import { git } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

it("authorizes changes reads separately from index mutations across HTTP", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "rebase-changes-http-")),
  );
  const directory = join(root, "repository");
  try {
    await git(root, "init", "-b", "main", directory);
    await writeFile(join(directory, "draft.txt"), "draft\n");
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const context = yield* acquireEnvironmentContext(
            environmentPaths(join(root, ".rebase-test")),
          );
          const authorization = createEnvironmentAuthorization(
            context,
            context.serverSecret,
          );
          const catalog = createRepositoryCatalog(
            context,
            createLocalGitCommandRunner(),
          );
          const repository = yield* catalog.remember(directory);
          const runner = createLocalGitCommandRunner();
          const features = yield* Effect.all([
            environmentAuthorizationFeature,
            repositoryChangesFeature,
            commitInspectionFeature,
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
          const credential = (role: "owner" | "viewer") =>
            Effect.gen(function* () {
              const pairing = yield* authorization.createPairing({
                role,
                capabilities: [],
              });
              return (yield* authorization.exchangePairing({
                pairingMaterial: pairing.material,
                label: role,
              })).credential;
            });
          const viewerToken = yield* credential("viewer");
          const ownerToken = yield* credential("owner");
          const viewer = bearerRequests(listener.origin, viewerToken);
          const owner = bearerRequests(listener.origin, ownerToken);
          const scope = {
            repositoryId: repository.id,
            worktreePath: directory,
            amend: false,
          };
          const snapshot = yield* viewer(RepositoryChangesHttpApi.read, scope);
          const command = {
            ...scope,
            revision: snapshot.revision,
            section: "unstaged" as const,
            action: "stage" as const,
            selection: { _tag: "Files" as const, paths: ["draft.txt"] },
            viewed: { section: "staged" as const, path: "draft.txt" },
          };
          const refused = yield* viewer(
            RepositoryChangesHttpApi.mutate,
            command,
          ).pipe(Effect.flip);
          expect(refused).toMatchObject({
            _tag: "EnvironmentAccessDenied",
            status: 403,
          });
          const staged = yield* owner(RepositoryChangesHttpApi.mutate, command);
          expect(staged.changes.staged).toEqual([
            { path: "draft.txt", previousPath: null, status: "A" },
          ]);
          expect(staged.diff?.after).toBe("draft\n");
          expect(
            (yield* owner(RepositoryChangesHttpApi.diff, {
              ...scope,
              section: "staged",
              path: "draft.txt",
            })).after,
          ).toBe("draft\n");
          yield* Effect.promise(() =>
            git(
              directory,
              "-c",
              "commit.gpgsign=false",
              "commit",
              "-m",
              "Initial",
            ),
          );
          const oid = yield* Effect.promise(() =>
            git(directory, "rev-parse", "HEAD"),
          );
          const inspectionScope = {
            repositoryId: repository.id,
            worktreePath: directory,
          };
          const details = yield* viewer(CommitInspectionHttpApi.inspect, {
            ...inspectionScope,
            oid,
          });
          expect(details.files).toEqual([
            { path: "draft.txt", previousPath: null, status: "A" },
          ]);
          expect(
            (yield* viewer(CommitInspectionHttpApi.inspectDiff, {
              ...inspectionScope,
              oid,
              path: "draft.txt",
            })).after,
          ).toBe("draft\n");
          expect(
            yield* viewer(CommitInspectionHttpApi.inspect, {
              ...inspectionScope,
              oid: "HEAD",
            }).pipe(Effect.flip),
          ).toMatchObject({ _tag: "EnvironmentResponseError" });
          const unauthorized = bearerRequests(listener.origin, "invalid");
          expect(
            yield* unauthorized(CommitInspectionHttpApi.inspect, {
              ...inspectionScope,
              oid,
            }).pipe(Effect.flip),
          ).toMatchObject({ _tag: "EnvironmentAccessDenied", status: 401 });
        }),
      ),
    );
  } finally {
    await removeTemporaryDirectory(root);
  }
});
