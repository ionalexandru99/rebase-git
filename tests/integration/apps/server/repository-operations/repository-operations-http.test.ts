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
import {
  createRepositoryOperationsService,
  createRepositoryWrites,
} from "#server/features/repository-operations/index";
import { acquireEnvironmentContext } from "#server/persistence/environment-context";
import { environmentPaths } from "#server/persistence/storage/environment-paths";
import { createRepositoryOperationsClient } from "#web/features/operation-recovery/transport/repository-operations-client";

it("authorizes operation discovery and recovery separately and rejects unrelated worktrees over HTTP", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "rebase-operation-http-")),
  );
  const directory = join(root, "repository");
  const exec = promisify(execFile);
  try {
    await exec("git", ["init", "-b", "main", directory]);
    const git = (...args: string[]) => exec("git", ["-C", directory, ...args]);
    await git("config", "user.name", "Test");
    await git("config", "user.email", "test@example.com");
    await git("config", "commit.gpgsign", "false");
    await writeFile(join(directory, "file.txt"), "base\n");
    await git("add", ".");
    await git("commit", "-m", "base");
    await git("checkout", "-b", "topic");
    await writeFile(join(directory, "file.txt"), "topic\n");
    await git("commit", "-am", "topic");
    await git("checkout", "main");
    await writeFile(join(directory, "file.txt"), "main\n");
    await git("commit", "-am", "main");
    await expect(git("merge", "topic")).rejects.toBeDefined();
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
          const runner = createLocalGitCommandRunner();
          const listener = yield* acquireEnvironmentListener({
            authorization,
            catalog,
            operations: createRepositoryOperationsService({
              catalog,
              git: runner,
              writes: createRepositoryWrites(runner),
            }),
            environmentId: "00000000-0000-4000-8000-000000000001",
            events: createEnvironmentEventPublisher(),
            productVersion: "0.0.0",
          });
          const client = (role: "owner" | "viewer") =>
            Effect.gen(function* () {
              const pairing = yield* authorization.createPairing({
                role,
                capabilities: [],
              });
              const result = yield* authorization.exchangePairing({
                pairingMaterial: pairing.material,
                label: role,
              });
              return createRepositoryOperationsClient(listener.origin, () => ({
                type: "bearer",
                value: result.credential,
              }));
            });
          const viewer = yield* client("viewer"),
            owner = yield* client("owner");
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
          const denied = yield* viewer.execute(command).pipe(Effect.flip);
          expect(denied.failure.reason).toBe("Unauthorized");
          expect((yield* owner.read(scope)).kind).toBe("merge");
          const missing = yield* owner
            .read({ ...scope, worktreePath: root })
            .pipe(Effect.flip);
          expect(missing.failure.reason).toBe("Missing");
          const result = yield* owner.execute(command);
          expect(result.operation.kind).toBe("idle");
          expect(result.invalidation).toEqual({
            status: true,
            refs: true,
            history: true,
          });
        }),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
