import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createCurrentEnvironmentHello,
  type EnvironmentServerMessage,
  environmentLivePath,
  type RepositoryFreshness,
  type RepositoryFreshnessClientMessage,
} from "@rebase/contracts";
import { createLocalGitCommandRunner } from "@rebase/server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "@rebase/server/adapters/local-git/local-repository-watcher";
import type { RepositoryCatalog } from "@rebase/server/domain/repository-catalog.contract";
import type { RepositoryFreshnessService } from "@rebase/server/domain/repository-freshness.contract";
import type { EnvironmentAuthorization } from "@rebase/server/features/environment-authorization/environment-authorization.contract";
import { createEnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher";
import { acquireEnvironmentListener } from "@rebase/server/features/environment-server/server/environment-listener";
import { acquireRepositoryFreshnessService } from "@rebase/server/features/repository-history/freshness/repository-freshness";
import { createRepositoryHistoryService } from "@rebase/server/features/repository-history/repository-history";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const exec = promisify(execFile);
const directories: string[] = [];
const repositoryId = "00000000-0000-4000-8000-000000000001";

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("repository freshness with real Git", { timeout: 30_000 }, () => {
  it("continues watching stash history after reflog directories are replaced", async () => {
    const fixture = await createFixture();
    const gitDirectory = join(fixture.local, ".git");
    let changes = 0;
    const watcher = await Effect.runPromise(
      createLocalRepositoryWatcher().watch(gitDirectory, () => {
        changes += 1;
      }),
    );
    try {
      for (const [index, entry] of ["logs/refs", "logs"].entries()) {
        const directory = join(gitDirectory, entry);
        const beforeReplacement = changes;
        await rename(directory, join(fixture.root, `previous-logs-${index}`));
        await mkdir(join(gitDirectory, "logs", "refs"), { recursive: true });
        await vi.waitFor(() =>
          expect(changes).toBeGreaterThan(beforeReplacement),
        );
        const beforeWrite = changes;
        await writeFile(
          join(gitDirectory, "logs", "refs", "stash"),
          `stash ${index}`,
        );
        await vi.waitFor(() => expect(changes).toBeGreaterThan(beforeWrite));
      }
    } finally {
      watcher.close();
    }
  });

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
        () => git(linked, "commit", "--allow-empty", "-m", "detached worktree"),
        () => git(fixture.local, "pack-refs", "--all"),
      ];
      for (const change of changes) {
        const before = states.at(-1)?.revision ?? 0;
        await change();
        const completed = performance.now();
        await vi.waitFor(
          () => expect(states.at(-1)?.revision).toBeGreaterThan(before),
          { timeout: 1_000, interval: 10 },
        );
        expect(performance.now() - completed).toBeLessThan(500);
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
        service.subscribe(repositoryId, (state) => states.push(state)),
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
    });
  });

  it("reports fetch failure and recovery over the same repository WebSocket", async () => {
    const fixture = await createFixture();
    await Effect.runPromise(
      Effect.gen(function* () {
        const runner = createLocalGitCommandRunner();
        const freshness = yield* acquireRepositoryFreshnessService({
          catalog: fixture.catalog,
          git: runner,
          watcher: createLocalRepositoryWatcher(),
        });
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
        yield* Effect.promise(async () => {
          const socket = new WebSocket(
            `${listener.origin.replace("http://", "ws://")}${environmentLivePath}?ticket=test`,
          );
          const messages: EnvironmentServerMessage[] = [];
          socket.addEventListener("message", (event) => {
            if (typeof event.data === "string")
              messages.push(JSON.parse(event.data));
          });
          await new Promise<void>((resolve, reject) => {
            socket.addEventListener("open", () => resolve(), { once: true });
            socket.addEventListener("error", reject, { once: true });
          });
          try {
            socket.send(JSON.stringify(createCurrentEnvironmentHello("0.0.0")));
            await vi.waitFor(() =>
              expect(
                messages.some((message) => message._tag === "HelloAccepted"),
              ).toBe(true),
            );
            const subscribeId = randomUUID();
            await request(socket, messages, {
              _tag: "SubscribeRepositoryHistory",
              repositoryId,
              requestId: subscribeId,
            });
            await git(
              fixture.local,
              "remote",
              "set-url",
              "origin",
              join(fixture.root, "missing"),
            );
            const failed = await request(socket, messages, {
              _tag: "FetchRepositoryHistory",
              repositoryId,
              requestId: randomUUID(),
            });
            expect(failed).toMatchObject({
              _tag: "RepositoryHistoryFreshness",
              freshness: { stale: true, failure: { _tag: "FetchFailed" } },
            });
            await git(
              fixture.local,
              "remote",
              "set-url",
              "origin",
              fixture.remote,
            );
            const recovered = await request(socket, messages, {
              _tag: "FetchRepositoryHistory",
              repositoryId,
              requestId: randomUUID(),
            });
            expect(recovered).toMatchObject({
              _tag: "RepositoryHistoryFreshness",
              freshness: { stale: false },
            });
            expect(socket.readyState).toBe(WebSocket.OPEN);
            socket.send(
              JSON.stringify({
                _tag: "UnsubscribeRepositoryHistory",
                repositoryId,
              }),
            );
          } finally {
            socket.close();
          }
        });
      }).pipe(Effect.scoped),
    );
  });
});

async function request(
  socket: WebSocket,
  messages: EnvironmentServerMessage[],
  message: Exclude<
    RepositoryFreshnessClientMessage,
    { _tag: "UnsubscribeRepositoryHistory" }
  >,
) {
  socket.send(JSON.stringify(message));
  await vi.waitFor(() =>
    expect(
      messages.some(
        (response) =>
          "requestId" in response && response.requestId === message.requestId,
      ),
    ).toBe(true),
  );
  return messages.find(
    (response) =>
      "requestId" in response && response.requestId === message.requestId,
  );
}

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
      const service = yield* acquireRepositoryFreshnessService({
        catalog: fixture.catalog,
        git: createLocalGitCommandRunner(),
        watcher: createLocalRepositoryWatcher(),
      });
      yield* Effect.promise(() => use(service));
    }).pipe(Effect.scoped),
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
    mintTicket: () => Effect.die("unused"),
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
