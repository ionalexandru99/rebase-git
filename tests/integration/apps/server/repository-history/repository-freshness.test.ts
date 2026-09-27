import { mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  RepositoryCatalogHttpApi,
  type RepositoryFreshness,
} from "@rebase/contracts";
import { Deferred, Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vite-plus/test";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import {
  acquireRepositoryFreshness,
  type RepositoryFreshnessService,
} from "#server/features/repository-history/freshness/repository-freshness";
import { cloneRepository, fastImport, git } from "#tests-support/git";
import { waitForObservation } from "#tests-support/observation";
import { openTestEnvironment, openTestServer } from "#tests-support/server";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";
import { connectCurrentEnvironmentEffect } from "#web/app/environment/connection/environment-protocol-client";
import { createRepositoryHistoryRpc } from "#web/features/repository-history/transport/repository-history-rpc";

const committer = "committer Rebase test <rebase@example.test> 0 +0000\n";

describe("repository freshness with real Git", () => {
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
          await waitForObservation(
            () => expect(changes).toBeGreaterThan(0),
            () => git(fixture.local, "branch", "-f", "watcher-ready"),
          );
          const directory = join(gitDirectory, entry);
          const beforeReplacement = changes;
          await rename(directory, join(fixture.root, "previous-logs"));
          await mkdir(join(gitDirectory, "logs", "refs"), { recursive: true });
          await waitForObservation(() =>
            expect(changes).toBeGreaterThan(beforeReplacement),
          );
          let writes = 0;
          const beforeWrite = changes;
          await waitForObservation(
            () => expect(changes).toBeGreaterThan(beforeWrite),
            () => {
              writes += 1;
              return writeFile(
                join(gitDirectory, "logs", "refs", "stash"),
                `stash ${writes}`,
              );
            },
          );
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
      await waitForObservation(
        () => expect(changes).toBeGreaterThan(0),
        () => git(fixture.local, "branch", "-f", "watcher-path"),
      );
    } finally {
      watcher.close();
    }
  });

  it("fetches the configured default remote, respects prune settings and keeps cached history after failure", async () => {
    const fixture = await createFixture();
    await withService(fixture, async (service, repositoryId) => {
      await Effect.runPromise(service.subscribe(repositoryId, () => {}));
      await git(fixture.remote, "branch", "temporary", "main");
      expect((await Effect.runPromise(service.fetch(repositoryId))).stale).toBe(
        false,
      );
      await git(fixture.local, "rev-parse", "refs/remotes/origin/temporary");
      await git(fixture.remote, "branch", "-D", "temporary");
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
    await withService(fixture, async (service, repositoryId) => {
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
        await waitForObservation(() =>
          expect(states.at(-1)?.revision).toBeGreaterThan(before),
        );
      }
      const beforeStashes = states.at(-1)?.revision ?? 0;
      await writeFile(join(fixture.local, "file.txt"), "first stash");
      await git(fixture.local, "stash", "push", "-m", "first");
      await writeFile(join(fixture.local, "file.txt"), "second stash");
      await git(fixture.local, "stash", "push", "-m", "second");
      await waitForObservation(() =>
        expect(states.at(-1)?.revision).toBeGreaterThan(beforeStashes),
      );
      const before = states.at(-1)?.revision ?? 0;
      const stashHead = await git(fixture.local, "rev-parse", "refs/stash");
      await git(fixture.local, "stash", "drop", "stash@{1}");
      expect(await git(fixture.local, "rev-parse", "refs/stash")).toBe(
        stashHead,
      );
      await waitForObservation(() =>
        expect(states.at(-1)?.revision).toBeGreaterThan(before),
      );
      expect(states.every((state) => !state.fetching)).toBe(true);
    });
  });

  it("persists repository settings and fetches on the scheduled interval", async () => {
    const fixture = await createFixture();
    await withService(fixture, async (service, repositoryId) => {
      await Effect.runPromise(service.subscribe(repositoryId, () => {}));
      await Effect.runPromise(
        service.configure(repositoryId, { _tag: "Interval", seconds: 1 }),
      );
    });
    const remoteHead = await commitToRemote(fixture, "new remote commit");
    const states: RepositoryFreshness[] = [];
    await withService(fixture, async (service, repositoryId) => {
      await Effect.runPromise(
        service.subscribe(repositoryId, (state) => states.push(state)),
      );
      expect(states[0]?.setting).toEqual({ _tag: "Interval", seconds: 1 });
      await waitForObservation(async () =>
        expect(await git(fixture.local, "rev-parse", "origin/main")).toBe(
          remoteHead,
        ),
      );
      const scheduledHead = await commitToRemote(
        fixture,
        "scheduled remote commit",
      );
      await waitForObservation(async () =>
        expect(await git(fixture.local, "rev-parse", "origin/main")).toBe(
          scheduledHead,
        ),
      );
      await waitForObservation(() =>
        expect(states.at(-1)?.fetching).toBe(false),
      );
    });
  });

  it("reports fetch failure and recovery over the same repository WebSocket", async () => {
    const fixture = await createFixture();
    const server = await openTestServer();
    const { id: repositoryId } = await server.requests(server.owner)(
      RepositoryCatalogHttpApi.remember,
      { path: fixture.local },
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const connection = yield* connectCurrentEnvironmentEffect(
          server.origin,
          "0.0.0",
          { credential: server.owner },
        );
        const transport = createRepositoryHistoryRpc(connection).freshness;
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
  onTestFinished(() => removeTemporaryDirectory(root));
  const remote = join(root, "remote.git");
  const local = join(root, "local");
  await git(root, "init", "--bare", "-b", "main", remote);
  await fastImport(
    remote,
    `commit refs/heads/main\n${committer}data <<END\nbase\nEND\nM 100644 inline file.txt\ndata <<END\nbase\nEND\n`,
  );
  await cloneRepository(
    remote,
    local,
    "--config",
    "rebase.autoFetchIntervalSeconds=0",
  );
  return { root, remote, local };
}

async function commitToRemote(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  message: string,
) {
  await fastImport(
    fixture.remote,
    `commit refs/heads/main\n${committer}data <<END\n${message}\nEND\nfrom refs/heads/main^0\n`,
  );
  return git(fixture.remote, "rev-parse", "main");
}

async function withService(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  use: (
    service: RepositoryFreshnessService,
    repositoryId: string,
  ) => Promise<void>,
) {
  const environment = await openTestEnvironment();
  const { id } = await environment.remember(fixture.local);
  await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* acquireRepositoryFreshness(environment);
      yield* Effect.promise(() => use(service, id));
    }).pipe(Effect.scoped),
  );
}
