import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import {
  createCommitInspectionHttpHandler,
  createCommitInspectionService,
} from "#server/features/commit-inspection/index";
import { createEnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization";
import { createEnvironmentAuthorizationHttpHandler } from "#server/features/environment-authorization/index";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "#server/features/environment-server/server/environment-listener";
import { createRepositoryAccess } from "#server/features/repository-access/index";
import { createRepositoryCatalog } from "#server/features/repository-catalog/repository-catalog";
import {
  createRepositoryChangesHttpHandler,
  createRepositoryChangesService,
} from "#server/features/repository-changes/index";
import { createRepositoryCoordination } from "#server/features/repository-coordination/index";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import { createCommitInspectionClient } from "#web/features/commit-inspection/transport/commit-inspection-client";
import { createRepositoryChangesClient } from "#web/features/working-changes/transport/repository-changes-client";

it("authorizes changes reads separately from index mutations across HTTP", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "rebase-changes-http-")),
  );
  const directory = join(root, "repository");
  try {
    await promisify(execFile)("git", ["init", "-b", "main", directory]);
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
          const access = createRepositoryAccess(catalog, runner);
          const listener = yield* acquireEnvironmentListener({
            authorization,
            httpHandlers: [
              createEnvironmentAuthorizationHttpHandler(authorization),
              createRepositoryChangesHttpHandler(
                authorization,
                createRepositoryChangesService(
                  access,
                  runner,
                  createRepositoryCoordination(runner),
                ),
              ),
              createCommitInspectionHttpHandler(
                authorization,
                createCommitInspectionService(access, runner),
              ),
            ],
            environmentId: "00000000-0000-4000-8000-000000000001",
            events: createEnvironmentEventPublisher(),
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
          const viewer = createRepositoryChangesClient(listener.origin, () => ({
            type: "bearer",
            value: viewerToken,
          }));
          const owner = createRepositoryChangesClient(listener.origin, () => ({
            type: "bearer",
            value: ownerToken,
          }));
          const scope = {
            repositoryId: repository.id,
            worktreePath: directory,
            amend: false,
          };
          const snapshot = yield* viewer.read(scope);
          const command = {
            ...scope,
            revision: snapshot.revision,
            section: "unstaged" as const,
            action: "stage" as const,
            selection: { _tag: "Files" as const, paths: ["draft.txt"] },
          };
          const refused = yield* viewer.mutate(command).pipe(Effect.flip);
          expect(refused.message).toContain("Could not complete");
          const staged = yield* owner.mutate(command);
          expect(staged.staged).toEqual([{ path: "draft.txt", status: "A" }]);
          expect(
            (yield* owner.diff({
              ...scope,
              section: "staged",
              path: "draft.txt",
            })).after,
          ).toBe("draft\n");
          yield* Effect.promise(() =>
            promisify(execFile)("git", [
              "-C",
              directory,
              "-c",
              "user.name=Test",
              "-c",
              "user.email=test@example.test",
              "-c",
              "commit.gpgsign=false",
              "commit",
              "-m",
              "Initial",
            ]),
          );
          const oid = (yield* Effect.promise(() =>
            promisify(execFile)("git", ["-C", directory, "rev-parse", "HEAD"]),
          )).stdout.trim();
          const inspection = createCommitInspectionClient(
            listener.origin,
            () => ({ type: "bearer", value: viewerToken }),
          );
          const inspectionScope = {
            repositoryId: repository.id,
            worktreePath: directory,
          };
          const details = yield* inspection.inspect({
            ...inspectionScope,
            oid,
          });
          expect(details.files).toEqual([
            { path: "draft.txt", previousPath: null, status: "A" },
          ]);
          expect(
            (yield* inspection.diff({
              ...inspectionScope,
              oid,
              path: "draft.txt",
            })).after,
          ).toBe("draft\n");
          expect(
            (yield* inspection
              .inspect({ ...inspectionScope, oid: "HEAD" })
              .pipe(Effect.flip)).message,
          ).toContain("Could not load");
          const unauthorized = createCommitInspectionClient(
            listener.origin,
            () => ({ type: "bearer", value: "invalid" }),
          );
          expect(
            (yield* unauthorized
              .inspect({ ...inspectionScope, oid })
              .pipe(Effect.flip)).message,
          ).toContain("Could not load");
        }),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
