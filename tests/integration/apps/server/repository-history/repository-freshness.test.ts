import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RepositoryFreshness } from "@rebase/contracts";
import { connectCurrentEnvironmentEffect } from "@rebase/web/features/environment-connection";
import { Context, Deferred, Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import { GitCommands } from "#server/domain/git-command.contract";
import {
  type RepositoryCatalog,
  RepositoryCatalogAccess,
} from "#server/domain/repository-catalog.contract";
import {
  type RepositoryFreshnessService,
  RepositoryFreshnessState,
} from "#server/domain/repository-freshness.contract";
import { RepositoryWatching } from "#server/domain/repository-watcher.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import { createEnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "#server/features/environment-server/server/environment-listener";
import { repositoryFreshnessLayer } from "#server/features/repository-history/freshness/repository-freshness";
import { createRepositoryHistoryService } from "#server/features/repository-history/repository-history";

const exec = promisify(execFile);
const directories: string[] = [];
const repositoryId = "00000000-0000-4000-8000-000000000001";

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) =>
      rm(path, {
        force: true,
        recursive: true,
        maxRetries: 3,
        retryDelay: 100,
      }),
    ),
  );
});

describe("repository freshness with real Git", { timeout: 30_000 }, () => {
  for (const entry of ["logs/refs", "logs"])
    it.skipIf(process.platform === "win32" && entry === "logs")(
      `continues watching stash history after ${entry} is replaced`,
      async () => {
        const fixture = await createFixture();
        const gitDirectory = join(fixture.local, ".git");
        let changes = 0;
        const watcher = await Effect.runPromise(
          createLocalRepositoryWatcher().watch(gitDirectory, () => {
            changes += 1;
          }),
        );
        try {
          await git(fixture.local, "branch", "watcher-ready");
          await vi.waitFor(() => expect(changes).toBeGreaterThan(0));
          const directory = join(gitDirectory, entry);
          const beforeReplacement = changes;
          await rename(directory, join(fixture.root, "previous-logs"));
          await mkdir(join(gitDirectory, "logs", "refs"), { recursive: true });
          await vi.waitFor(() =>
            expect(changes).toBeGreaterThan(beforeReplacement),
          );
          const beforeWrite = changes;
          await writeFile(join(gitDirectory, "logs", "refs", "stash"), "stash");
          await vi.waitFor(() => expect(changes).toBeGreaterThan(beforeWrite));
        } finally {
          watcher.close();
        }
      },
    );

  it("watches Git paths with forward slashes on every platform", async () => {
    const fixture = await createFixture();
    const gitDirectory = join(fixture.local, ".git").replaceAll("\\", "/");
    let changes = 0;
    const watcher = await Effect.runPromise(
      createLocalRepositoryWatcher().watch(gitDirectory, () => {
        changes += 1;
      }),
    );
    try {
      await git(fixture.local, "branch", "watcher-path");
      await vi.waitFor(() => expect(changes).toBeGreaterThan(0));
    } finally {
      watcher.close();
    }
  });

  it("fetches the configured default remote, respects prune settings and keeps cached history after failure", async () => {
    const fixture = await createFixture();
    await withService(fixture, async (service) => {
      await Effect.runPromise(service.subscribe(repositoryId, () => {}));
      await git(fixture.source, "branch", "temporary");
      await git(fixture.source, "push", "origin", "temporary");
      expect((await Effect.runPromise(service.fetch(repositoryId))).stale).toBe(
        false,
      );
      await git(fixture.local, "rev-parse", "refs/remotes/origin/temporary");
      await git(fixture.source, "push", "origin", "--delete", "temporary");
      await Effect.runPromise(service.fetch(repositoryId));
      await git(fixture.local, "rev-parse", "refs/remotes/origin/temporary");
      await git(fixture.local, "config", "fetch.prune", "true");
      await Effect.runPromise(service.fetch(repositoryId));
      await expect(
        git(
          fixture.local,
          "show-ref",
          "--verify",
          "refs/remotes/origin/temporary",
        ),
      ).rejects.toThrow();
      const cachedHead = await git(fixture.local, "rev-parse", "HEAD");
      await git(
        fixture.local,
        "remote",
        "set-url",
        "origin",
        join(fixture.root, "missing"),
      );
      expect(
        await Effect.runPromise(service.fetch(repositoryId)),
      ).toMatchObject({
        stale: true,
        fetching: false,
        failure: { _tag: "FetchFailed" },
      });
      expect(await git(fixture.local, "rev-parse", "HEAD")).toBe(cachedHead);
      await git(fixture.local, "remote", "set-url", "origin", fixture.remote);
      expect(
        await Effect.runPromise(service.fetch(repositoryId)),
      ).toMatchObject({ stale: false, fetching: false });
    });
  });

  it("detects branch, tag, linked HEAD and old stash changes while automatic fetch is disabled", async () => {
    const fixture = await createFixture();
    const linked = join(fixture.root, "linked");
    await git(fixture.local, "worktree", "add", "--detach", linked);
    const states: RepositoryFreshness[] = [];
    await withService(fixture, async (service) => {
      await Effect.runPromise(
        service.subscribe(repositoryId, (state) => states.push(state)),
      );
      const changes = [
        () => git(fixture.local, "branch", "local-branch"),
        () => git(fixture.local, "tag", "local-tag"),
        () => git(fixture.local, "commit", "--amend", "-m", "first amendment"),
        () => git(fixture.local, "commit", "--amend", "-m", "second amendment"),
        () => git(linked, "commit", "--allow-empty", "-m", "detached worktree"),
        () => git(fixture.local, "pack-refs", "--all"),
      ];
      for (const change of changes) {
        const before = states.at(-1)?.revision ?? 0;
        await change();
        await vi.waitFor(
          () => expect(states.at(-1)?.revision).toBeGreaterThan(before),
          { timeout: 1_000, interval: 10 },
        );
      }
      const beforeStashes = states.at(-1)?.revision ?? 0;
      await writeFile(join(fixture.local, "file.txt"), "first stash");
      await git(fixture.local, "stash", "push", "-m", "first");
      await writeFile(join(fixture.local, "file.txt"), "second stash");
      await git(fixture.local, "stash", "push", "-m", "second");
      await vi.waitFor(() =>
        expect(states.at(-1)?.revision).toBeGreaterThan(beforeStashes),
      );
      const before = states.at(-1)?.revision ?? 0;
      const stashHead = await git(fixture.local, "rev-parse", "refs/stash");
      await git(fixture.local, "stash", "drop", "stash@{1}");
      expect(await git(fixture.local, "rev-parse", "refs/stash")).toBe(
        stashHead,
      );
      await vi.waitFor(() =>
        expect(states.at(-1)?.revision).toBeGreaterThan(before),
      );
      expect(states.every((state) => !state.fetching)).toBe(true);
    });
  });

  it("persists repository settings and fetches on the scheduled interval", async () => {
    const fixture = await createFixture();
    await withService(fixture, async (service) => {
      await Effect.runPromise(service.subscribe(repositoryId, () => {}));
      await Effect.runPromise(
        service.configure(repositoryId, { _tag: "Interval", seconds: 1 }),
      );
    });
    await git(
      fixture.source,
      "commit",
      "--allow-empty",
      "-m",
      "new remote commit",
    );
    await git(fixture.source, "push", "origin", "main");
    const remoteHead = await git(fixture.source, "rev-parse", "HEAD");
    const states: RepositoryFreshness[] = [];
    await withService(fixture, async (service) => {
      await Effect.runPromise(
        service.subscribe(repositoryId, (state) => states.push(state), {
          automaticFetch: true,
        }),
      );
      expect(states[0]?.setting).toEqual({ _tag: "Interval", seconds: 1 });
      await vi.waitFor(async () =>
        expect(await git(fixture.local, "rev-parse", "origin/main")).toBe(
          remoteHead,
        ),
      );
      await git(
        fixture.source,
        "commit",
        "--allow-empty",
        "-m",
        "scheduled remote commit",
      );
      await git(fixture.source, "push", "origin", "main");
      const scheduledHead = await git(fixture.source, "rev-parse", "HEAD");
      await vi.waitFor(
        async () =>
          expect(await git(fixture.local, "rev-parse", "origin/main")).toBe(
            scheduledHead,
          ),
        { timeout: 3_000 },
      );
      await vi.waitFor(() => expect(states.at(-1)?.fetching).toBe(false));
    });
  });

  it("reports fetch failure and recovery over the same repository WebSocket", async () => {
    const fixture = await createFixture();
    await Effect.runPromise(
      Effect.gen(function* () {
        const runner = createLocalGitCommandRunner();
        const context = yield* Layer.build(freshnessLayer(fixture.catalog));
        const freshness = Context.get(context, RepositoryFreshnessState);
        const listener = yield* acquireEnvironmentListener({
          authorization: testAuthorization(),
          environmentId: repositoryId,
          events: createEnvironmentEventPublisher(),
          history: createRepositoryHistoryService({
            catalog: fixture.catalog,
            git: runner,
          }),
          freshness,
          productVersion: "0.0.0",
        });
        listener.readiness.value = true;
        const connection = yield* connectCurrentEnvironmentEffect(
          listener.origin,
          "0.0.0",
          { credential: { type: "bearer", value: "test" } },
        );
        const transport = connection.repositoryHistory.freshness;
        if (transport === undefined)
          throw new Error("Missing freshness transport");
        const observing = yield* Deferred.make<void>();
        yield* transport
          .observe(repositoryId, () =>
            Deferred.doneUnsafe(observing, Effect.void),
          )
          .pipe(Effect.forkScoped);
        yield* Deferred.await(observing);
        yield* Effect.promise(() =>
          git(
            fixture.local,
            "remote",
            "set-url",
            "origin",
            join(fixture.root, "missing"),
          ),
        );
        const failed = yield* transport.fetch(repositoryId);
        expect(failed).toMatchObject({
          stale: true,
          failure: { _tag: "FetchFailed" },
        });
        yield* Effect.promise(() =>
          git(fixture.local, "remote", "set-url", "origin", fixture.remote),
        );
        const recovered = yield* transport.fetch(repositoryId);
        expect(recovered).toMatchObject({ stale: false });
      }).pipe(Effect.scoped),
    );
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), "rebase freshness "));
  directories.push(root);
  const remote = join(root, "remote.git");
  const source = join(root, "source");
  const local = join(root, "local");
  await git(root, "init", "--bare", "-b", "main", remote);
  await git(root, "clone", remote, source);
  await writeFile(join(source, "file.txt"), "base");
  await git(source, "add", "file.txt");
  await git(source, "commit", "-m", "base");
  await git(source, "push", "origin", "main");
  await git(root, "clone", remote, local);
  await git(local, "config", "rebase.autoFetchIntervalSeconds", "0");
  const entry = {
    id: repositoryId,
    logicalRepositoryId: repositoryId,
    path: local,
    name: "local",
    addedAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString(),
  };
  const catalog: RepositoryCatalog = {
    find: () => Effect.succeed(entry),
    list: () => Effect.succeed([entry]),
    recordOpened: () => Effect.succeed(entry),
    remember: () => Effect.succeed(entry),
    remove: () => Effect.succeed({ repositoryId }),
  };
  return { root, remote, source, local, catalog };
}

function withService(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  use: (service: RepositoryFreshnessService) => Promise<void>,
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const context = yield* Layer.build(freshnessLayer(fixture.catalog));
      const service = Context.get(context, RepositoryFreshnessState);
      yield* Effect.promise(() => use(service));
    }).pipe(Effect.scoped),
  );
}

function freshnessLayer(catalog: RepositoryCatalog) {
  return repositoryFreshnessLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(RepositoryCatalogAccess, catalog),
        Layer.succeed(GitCommands, createLocalGitCommandRunner()),
        Layer.succeed(RepositoryWatching, createLocalRepositoryWatcher()),
      ),
    ),
  );
}

function testAuthorization(): EnvironmentAuthorization {
  const authorization = {
    capabilities: [
      "environment.read",
      "repository.read",
      "repository.write",
    ] as const,
    id: randomUUID(),
    label: "Test",
    role: "contributor" as const,
  };
  return {
    authorize: () => Effect.succeed(authorization),
    consumeTicket: () => Effect.succeed(authorization),
    createPairing: () => Effect.die("unused"),
    exchangePairing: () => Effect.die("unused"),
    mintTicket: () =>
      Effect.succeed({
        ticket: "test-ticket-material-00000000000000000000",
        expiresAt: "2026-09-06T00:00:00.000Z",
      }),
    revoke: () => Effect.die("unused"),
  };
}

async function git(path: string, ...args: string[]) {
  const result = await exec("git", [
    "-C",
    path,
    "-c",
    "user.name=Rebase test",
    "-c",
    "user.email=rebase@example.test",
    ...args,
  ]);
  return result.stdout.trim();
}
