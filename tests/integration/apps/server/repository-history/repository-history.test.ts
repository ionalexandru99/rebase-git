import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type {
  RepositoryCommit,
  RepositoryHistoryTips,
  RepositoryHistoryUpdate,
  SynchronizeRepositoryHistory,
} from "#contracts/repository-history/repository-history.contract.ts";
import {
  type GitCommandRunner,
  gitFailed,
} from "#server/adapters/local-git/git-commands.ts";
import {
  cloneRepository,
  createRepository,
  fastImport,
  git,
} from "#tests-support/git.ts";
import { openTestServer } from "#tests-support/server.ts";
import { openEnvironmentSocket } from "#web/platform/environment/environment-connection.ts";

const unchanged = { changed: () => {} };

describe("repository history synchronization", () => {
  it.each(["sha1", "sha256"] as const)(
    "streams every %s commit newest first after the tips",
    async (objectFormat) => {
      const history = await openHistory();
      const path = join(history.home, objectFormat);
      await importLinearHistory(path, objectFormat, 300);

      const synchronized = await history.synchronize(path);

      expect(synchronized.tips.objectFormat).toBe(objectFormat);
      expect(synchronized.commits).toHaveLength(300);
      expect(synchronized.commits[0]?.subject).toBe("commit 299");
      expect(synchronized.commits.at(-1)?.subject).toBe("commit 0");
      expect(
        synchronized.commits.every(
          ({ oid }) => oid.length === (objectFormat === "sha1" ? 40 : 64),
        ),
      ).toBe(true);
    },
  );

  it("synchronizes refs, stashes, detached linked worktree heads and large messages", async () => {
    const history = await openHistory();
    const path = join(history.home, "complete");
    const linked = join(history.home, "linked");
    await importLinearHistory(path, "sha1", 2);
    await git(path, "checkout", "-b", "side");
    const subject = 'long "message" 😀'.repeat(4_000);
    const message = join(history.home, "large-message.txt");
    await writeFile(message, subject);
    await git(path, "commit", "--allow-empty", "-F", message);
    const side = await git(path, "rev-parse", "HEAD");
    await git(path, "checkout", "main");
    await git(path, "update-ref", "refs/remotes/origin/side", side);
    await git(path, "tag", "snapshot");
    await writeFile(join(path, "stashed.txt"), "stashed");
    await git(path, "add", "stashed.txt");
    await git(path, "stash", "push", "-m", "saved work");
    await git(path, "worktree", "add", "--detach", linked, "main");
    await git(linked, "commit", "--allow-empty", "-m", "detached linked");
    const detached = await git(linked, "rev-parse", "HEAD");
    const stash = await git(path, "stash", "list", "--format=%H");
    const expected = (
      await git(path, "rev-list", "--all", detached, stash)
    ).split("\n");

    const synchronized = await history.synchronize(path);

    expect(new Set(synchronized.commits.map(({ oid }) => oid))).toEqual(
      new Set(expected),
    );
    expect(synchronized.commits.find(({ oid }) => oid === side)?.subject).toBe(
      subject,
    );
    expect(synchronized.tips.refTargets).toContainEqual({
      name: "origin/side",
      oid: side,
      type: "remote-branch",
    });
  });

  it("answers a repository without commits with no tips instead of an error", async () => {
    const history = await openHistory();
    const path = join(history.home, "empty");
    await createRepository(path, { commits: [] });

    const synchronized = await history.synchronize(path);

    expect(synchronized.tips.rootOids).toEqual([]);
    expect(synchronized.tips.refTargets).toEqual([]);
    expect(synchronized.commits).toEqual([]);
  });

  it("keeps nested and octopus merges in topological order", async () => {
    const history = await openHistory();
    const path = join(history.home, "merges");
    await createMergeRepository(path);

    const { commits } = await history.synchronize(path);

    expect(commits[0]?.parents).toHaveLength(3);
    const positions = new Map(commits.map(({ oid }, index) => [oid, index]));
    for (const [index, commit] of commits.entries())
      for (const parent of commit.parents)
        expect(positions.get(parent)).toBeGreaterThan(index);
  });

  it("sends only unknown commits and keeps what the reflog still reaches after a force push", async () => {
    const history = await openHistory();
    const path = join(history.home, "incremental");
    await importLinearHistory(path, "sha1", 3);
    const initial = await history.synchronize(path);
    await git(path, "commit", "--allow-empty", "-m", "appended");

    const appended = await history.synchronize(path, initial.tips);

    expect(appended.commits.map(({ subject }) => subject)).toEqual([
      "appended",
    ]);
    await git(path, "reset", "--hard", "HEAD~2");
    await git(path, "commit", "--allow-empty", "-m", "rewritten");

    const rewritten = await history.synchronize(path, appended.tips);

    expect(rewritten.commits.map(({ subject }) => subject)).toEqual([
      "rewritten",
    ]);
    expect(rewritten.tips.refTargets).toContainEqual({
      name: "main",
      oid: await git(path, "rev-parse", "main"),
      type: "branch",
    });
    const collected = await history.synchronize(path, {
      ...rewritten.tips,
      rootOids: ["f".repeat(40)],
    });
    expect(new Set(collected.commits.map(({ subject }) => subject))).toEqual(
      new Set(["rewritten", "appended", "commit 2", "commit 1", "commit 0"]),
    );
  });

  it("restores shallow parents and resends history when the boundary moves", async () => {
    const history = await openHistory();
    const source = join(history.home, "shallow-source");
    const clone = join(history.home, "shallow-clone");
    await createRepository(source, { commits: [] });
    for (let index = 0; index < 4; index += 1)
      await git(source, "commit", "--allow-empty", "-m", `commit ${index}`);
    await cloneRepository(pathToFileURL(source).href, clone, "--depth=2");
    const oids = (await git(source, "rev-list", "HEAD")).split("\n");

    const shallow = await history.synchronize(clone);

    expect(shallow.tips.shallowOids).toEqual([oids[1]]);
    expect(shallow.commits.map(({ oid }) => oid)).toEqual(oids.slice(0, 2));
    expect(shallow.commits.at(-1)?.parents).toEqual([oids[2]]);
    await git(clone, "fetch", "--deepen=1");

    const deepened = await history.synchronize(clone, shallow.tips);

    expect(deepened.tips.shallowOids).toEqual([oids[2]]);
    expect(deepened.commits.map(({ oid }) => oid)).toEqual(oids.slice(0, 3));
  });

  it("waits for the browser to store each batch before finishing", async () => {
    const history = await openHistory();
    const path = join(history.home, "backpressure");
    await importLinearHistory(path, "sha1", 1);
    const stored = Promise.withResolvers<void>();
    let finished = false;

    const synchronized = history
      .synchronize(path, undefined, async (update) => {
        if (update._tag === "RepositoryHistoryCommits") await stored.promise;
      })
      .then(() => {
        finished = true;
      });
    await expect.poll(() => history.received()).toBeGreaterThan(1);
    expect(finished).toBe(false);
    stored.resolve();
    await synchronized;
    expect(finished).toBe(true);
  });

  it("interrupts Git when the browser cancels and keeps the socket usable", async () => {
    const started = Promise.withResolvers<void>();
    const interrupted = Promise.withResolvers<void>();
    let hang = true;
    const history = await openHistory((local) => ({
      ...local,
      stream: (command) =>
        hang && command.arguments[0] === "log"
          ? Stream.fromEffect(
              Effect.sync(() => started.resolve()).pipe(
                Effect.andThen(Effect.never),
                Effect.ensuring(Effect.sync(() => interrupted.resolve())),
              ),
            )
          : local.stream(command),
    }));
    const path = join(history.home, "cancel");
    await importLinearHistory(path, "sha1", 1);
    const controller = new AbortController();

    const cancelled = history.synchronize(
      path,
      undefined,
      undefined,
      controller.signal,
    );
    await started.promise;
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ _tag: "Cancelled" });
    await interrupted.promise;
    hang = false;

    expect((await history.synchronize(path)).commits).toHaveLength(1);
  });

  it("reports a Git timeout by its reason alone", async () => {
    const history = await openHistory((local) => ({
      ...local,
      stream: (command) =>
        command.arguments[0] === "log"
          ? Stream.fail(gitFailed("Timeout"))
          : local.stream(command),
    }));
    const path = join(history.home, "timeout");
    await importLinearHistory(path, "sha1", 1);

    const failure = await history.synchronize(path).catch((error) => error);

    expect(failure).toEqual({
      _tag: "Rejected",
      failure: { _tag: "GitFailed", reason: "Timeout" },
    });
  });
});

async function openHistory(
  override?: (git: GitCommandRunner) => GitCommandRunner,
) {
  const server = await openTestServer({ git: override });
  const socket = await openEnvironmentSocket(
    server.origin,
    server.owner,
    unchanged,
  );
  const requests = server.requests(server.owner);
  let received = 0;
  return {
    home: server.home,
    received: () => received,
    synchronize: async (
      path: string,
      known?: RepositoryHistoryTips,
      accept?: (update: RepositoryHistoryUpdate) => Promise<void>,
      signal = new AbortController().signal,
    ) => {
      const repository = await requests(RepositoryCatalogApi.remember, {
        path,
      });
      const request: SynchronizeRepositoryHistory = {
        repositoryId: repository.id,
        knownTips: known?.rootOids ?? [],
        shallowOids: known?.shallowOids ?? [],
      };
      const commits: RepositoryCommit[] = [];
      let tips: RepositoryHistoryTips | undefined;
      await socket.synchronizeHistory(
        request,
        async (update) => {
          received += 1;
          if (update._tag === "RepositoryHistoryTips") tips = update;
          else commits.push(...update.commits);
          await accept?.(update);
        },
        signal,
      );
      if (tips === undefined) throw new Error("No tips were sent");
      return { tips, commits };
    },
  };
}

async function importLinearHistory(
  path: string,
  objectFormat: "sha1" | "sha256",
  commitCount: number,
) {
  await mkdir(path, { recursive: true });
  await git(path, "init", `--object-format=${objectFormat}`, "-b", "main");
  const commands: string[] = [];
  for (let index = 0; index < commitCount; index += 1) {
    const subject = `commit ${index}`;
    commands.push(
      "commit refs/heads/main\n",
      `mark :${index + 1}\n`,
      `committer Rebase test <rebase@example.test> ${1_700_000_000 + index} +0000\n`,
      `data ${Buffer.byteLength(subject)}\n${subject}\n`,
      index === 0 ? "" : `from :${index}\n`,
      "\n",
    );
  }
  await fastImport(path, commands.join(""));
}

async function createMergeRepository(path: string) {
  await createRepository(path, { commits: [] });
  await commitFile(path, "base.txt", "base");
  await git(path, "checkout", "-b", "feature");
  await commitFile(path, "feature.txt", "feature one");
  await git(path, "checkout", "-b", "nested");
  await commitFile(path, "nested.txt", "nested");
  await git(path, "checkout", "feature");
  await commitFile(path, "feature.txt", "feature two");
  await git(path, "merge", "--no-ff", "nested", "-m", "nested merge");
  await git(path, "checkout", "main");
  await commitFile(path, "main.txt", "main");
  await git(path, "merge", "--no-ff", "feature", "-m", "feature merge");
  await git(path, "checkout", "-b", "octo-a");
  await commitFile(path, "octo-a.txt", "octo a");
  await git(path, "checkout", "main");
  await git(path, "checkout", "-b", "octo-b");
  await commitFile(path, "octo-b.txt", "octo b");
  await git(path, "checkout", "main");
  await git(path, "merge", "--no-ff", "octo-a", "octo-b", "-m", "octopus");
}

async function commitFile(path: string, name: string, subject: string) {
  await writeFile(join(path, name), subject);
  await git(path, "add", name);
  await git(path, "commit", "-m", subject);
}
