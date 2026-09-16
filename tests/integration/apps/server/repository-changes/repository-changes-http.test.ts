import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createEnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "#server/features/environment-server/server/environment-listener";
import { createRepositoryCatalog } from "#server/features/repository-catalog/repository-catalog";
import { createRepositoryChangesService } from "#server/features/repository-changes/index";
import { createRepositoryWrites } from "#server/features/repository-operations/index";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
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
          const catalog = createRepositoryCatalog(context);
          const repository = yield* catalog.remember(directory);
          const git = createLocalGitCommandRunner();
          const listener = yield* acquireEnvironmentListener({
            authorization,
            catalog,
            changes: createRepositoryChangesService(
              catalog,
              git,
              createRepositoryWrites(git),
            ),
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
        }),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
