import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createCurrentEnvironmentHello,
  decodeRepositoryHistoryBatch,
  decodeRepositoryHistoryPage,
  RepositoryCatalogHttpApi,
} from "@rebase/contracts";
import { fetchEnvironmentDiscoveryEffect } from "@rebase/environment-client";
import { Deferred, Effect, Fiber, type Scope } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands";
import { fastImport, git } from "#tests-support/git";
import { openTestServer } from "#tests-support/server";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";
import { connectEnvironmentEffect } from "#web/app/environment/connection/environment-protocol-client";
import type { RepositoryHistoryTransport } from "#web/features/repository-history/repository-history-reader";
import { createRepositoryHistoryRpc } from "#web/features/repository-history/transport/repository-history-rpc";

const longSubject = 'long "message" 😀'.repeat(4_000);
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => removeTemporaryDirectory(path)),
  );
});

describe("Effect RPC over WebSockets", () => {
  it("streams a large history page within the negotiated frame limit", async () => {
    const repository = await createHistoryRepository(longSubject);
    await withHistory(repository, (history, query) =>
      Effect.gen(function* () {
        const page = decodeRepositoryHistoryPage(yield* history.read(query));
        expect(page.commits[0]?.subject).toBe(longSubject);
      }),
    );
  });

  it("waits for browser storage before finishing synchronization", async () => {
    const repository = await createHistoryRepository("commit");
    await withHistory(repository, (history, query) =>
      Effect.gen(function* () {
        const received = yield* Deferred.make<void>();
        const stored = yield* Deferred.make<void>();
        let finished = false;
        const sequences: number[] = [];
        const sync = yield* history
          .synchronize(
            { repositoryId: query.repositoryId, priority: "visible" },
            (bytes) =>
              Effect.gen(function* () {
                sequences.push(decodeRepositoryHistoryBatch(bytes).sequence);
                yield* Deferred.succeed(received, undefined);
                yield* Deferred.await(stored);
              }),
          )
          .pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                finished = true;
              }),
            ),
            Effect.forkScoped,
          );
        yield* Deferred.await(received);
        expect(finished).toBe(false);
        yield* Deferred.succeed(stored, undefined);
        expect(yield* Fiber.join(sync)).toBe(1);
        expect(finished).toBe(true);
        expect(sequences[0]).toBe(0);
      }),
    );
  });

  it("interrupts server work when a caller cancels, and keeps the connection usable", async () => {
    const repository = await createHistoryRepository("commit");
    const started = Deferred.makeUnsafe<void>();
    const interrupted = Deferred.makeUnsafe<void>();
    let hang = true;
    await withHistory(
      repository,
      (history, query) =>
        Effect.gen(function* () {
          const reading = yield* history.read(query).pipe(Effect.forkScoped);
          yield* Deferred.await(started);
          yield* Fiber.interrupt(reading);
          yield* Deferred.await(interrupted);
          hang = false;
          expect(
            yield* history.synchronize(
              { repositoryId: query.repositoryId, priority: "visible" },
              () => Effect.void,
            ),
          ).toBe(1);
        }),
      (local) => ({
        ...local,
        run: (command) =>
          hang && command.arguments[0] === "log"
            ? Deferred.succeed(started, undefined).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Deferred.succeed(interrupted, undefined)),
              )
            : local.run(command),
      }),
    );
  });

  it("bounds concurrent history reads on one connection", async () => {
    const repository = await createHistoryRepository("commit");
    const occupied = Deferred.makeUnsafe<void>();
    let active = 0;
    await withHistory(
      repository,
      (history, query) =>
        Effect.gen(function* () {
          const first = yield* history.read(query).pipe(Effect.forkScoped);
          const second = yield* history.read(query).pipe(Effect.forkScoped);
          yield* Deferred.await(occupied);
          const failure = yield* history.read(query).pipe(Effect.flip);
          expect(failure).toMatchObject({
            _tag: "RepositoryHistoryRejected",
            failure: { _tag: "GitFailed" },
          });
          expect(active).toBe(2);
          yield* Fiber.interrupt(first);
          yield* Fiber.interrupt(second);
        }),
      (local) => ({
        ...local,
        run: (command) =>
          command.arguments[0] === "log"
            ? Effect.gen(function* () {
                active += 1;
                if (active === 2) yield* Deferred.succeed(occupied, undefined);
                return yield* Effect.never;
              })
            : local.run(command),
      }),
    );
  });
});

async function createHistoryRepository(subject: string) {
  const path = await realpath(await mkdtemp(join(tmpdir(), "rebase rpc ")));
  directories.push(path);
  await git(path, "init", "-b", "main");
  await fastImport(
    path,
    `commit refs/heads/main\ncommitter Alex <alex@example.test> 0 +0000\ndata ${Buffer.byteLength(subject)}\n${subject}\n\n`,
  );
  return { head: await git(path, "rev-parse", "main"), path };
}

async function withHistory(
  repository: { readonly head: string; readonly path: string },
  use: (
    history: RepositoryHistoryTransport,
    query: {
      readonly repositoryId: string;
      readonly order: "topological";
      readonly limit: number;
      readonly roots: readonly {
        readonly name: string;
        readonly oid: string;
        readonly type: "branch";
      }[];
    },
  ) => Effect.Effect<void, unknown, Scope.Scope>,
  gitOverride?: (git: GitCommandRunner) => GitCommandRunner,
) {
  const server = await openTestServer({ git: gitOverride });
  const { id: repositoryId } = await server.requests(server.owner)(
    RepositoryCatalogHttpApi.remember,
    { path: repository.path },
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const discovery = yield* fetchEnvironmentDiscoveryEffect(server.origin);
      const hello = createCurrentEnvironmentHello("0.0.0");
      const connection = yield* connectEnvironmentEffect(
        server.origin,
        discovery,
        {
          ...hello,
          receiveLimits: {
            ...hello.receiveLimits,
            maxWebSocketResponseBytes: 4_096,
          },
        },
        server.owner,
      );
      yield* use(createRepositoryHistoryRpc(connection), {
        repositoryId,
        order: "topological",
        limit: 100,
        roots: [{ name: "main", oid: repository.head, type: "branch" }],
      });
    }).pipe(Effect.scoped),
  );
}
