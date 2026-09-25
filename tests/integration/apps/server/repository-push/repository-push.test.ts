import { chmod, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PushBranch, PushDestination } from "@rebase/contracts";
import { Effect, Fiber } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { createLocalGitCommandRunner } from "#server/adapters/local-git/local-git-command-runner";
import { createLocalRepositoryWatcher } from "#server/adapters/local-git/local-repository-watcher";
import {
  GitCommandError,
  type GitCommandRunner,
} from "#server/domain/git-command.contract";
import { createRepositoryPushService } from "#server/features/repository-push/repository-push";
import {
  createRepositoryAccess,
  createRepositoryCoordination,
} from "#server/repository/access/index";
import { createRepository, git } from "#tests-support/git";
import { removeTemporaryDirectory } from "#tests-support/temporary-directory";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => removeTemporaryDirectory(path)),
  );
});

async function fixture(wrap?: (runner: GitCommandRunner) => GitCommandRunner) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rebase-push-")));
  directories.push(root);
  const remote = join(root, "remote.git");
  const local = join(root, "local");
  const other = join(root, "other");
  await git(root, "init", "--bare", "-b", "main", remote);
  await createRepository(local);
  await git(local, "remote", "add", "origin", remote);
  await git(local, "push", "-u", "origin", "main");
  await git(root, "clone", remote, other);
  const runner = createLocalGitCommandRunner();
  const service = createRepositoryPushService(
    createRepositoryAccess(
      {
        find: () =>
          Effect.succeed({
            id: repositoryId,
            path: local,
            name: "test",
            addedAt: "",
            lastOpenedAt: "",
          }),
      },
      runner,
      createLocalRepositoryWatcher(),
    ),
    wrap?.(runner) ?? runner,
    createRepositoryCoordination(runner),
  );
  const scope = { repositoryId, worktreePath: local };
  const push = (
    branch: string,
    destination: PushDestination = { remote: "origin", branch },
    options: Partial<Pick<PushBranch, "setUpstream" | "mode">> = {},
  ) =>
    service.push({
      ...scope,
      branch,
      destination,
      setUpstream: false,
      mode: { _tag: "FastForward" },
      ...options,
    });
  const failure = <A>(effect: Effect.Effect<A, { failure: unknown }>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.flip,
        Effect.map((error) => error.failure),
      ),
    );
  const tip = (path: string, ref: string) => git(path, "rev-parse", ref);
  return { root, remote, local, other, service, scope, push, failure, tip };
}

async function commit(path: string, message: string) {
  await git(path, "commit", "--allow-empty", "-m", message);
  return git(path, "rev-parse", "HEAD");
}

describe("pushing branches", () => {
  it("publishes a new branch and tracks it", async () => {
    const f = await fixture();
    await git(f.local, "switch", "-c", "topic");
    const pushed = await commit(f.local, "topic work");

    const result = await Effect.runPromise(
      f.push("topic", undefined, { setUpstream: true }),
    );

    expect(result).toEqual({
      destination: { remote: "origin", branch: "topic" },
      target: pushed,
    });
    expect(await f.tip(f.remote, "refs/heads/topic")).toBe(pushed);
    expect(
      await git(f.local, "rev-parse", "--abbrev-ref", "topic@{upstream}"),
    ).toBe("origin/topic");
  });

  it("pushes to an explicit branch without changing the upstream", async () => {
    const f = await fixture();
    const pushed = await commit(f.local, "review copy");

    await Effect.runPromise(
      f.push("main", { remote: "origin", branch: "review/main" }),
    );

    expect(await f.tip(f.remote, "refs/heads/review/main")).toBe(pushed);
    expect(await f.tip(f.local, "refs/remotes/origin/review/main")).toBe(
      pushed,
    );
    expect(
      await git(f.local, "rev-parse", "--abbrev-ref", "main@{upstream}"),
    ).toBe("origin/main");
  });

  it("rejects a push when the remote has commits the branch lacks", async () => {
    const f = await fixture();
    const theirs = await commit(f.other, "their work");
    await git(f.other, "push", "origin", "main");
    await commit(f.local, "my work");

    expect(await f.failure(f.push("main"))).toMatchObject({
      reason: "NonFastForward",
    });
    expect(await f.tip(f.remote, "refs/heads/main")).toBe(theirs);
  });

  it("force pushes a rewritten branch with the reviewed remote tip", async () => {
    const f = await fixture();
    await commit(f.local, "draft");
    await git(f.local, "push", "origin", "main");
    await git(f.local, "reset", "--hard", "HEAD~1");
    const rewritten = await commit(f.local, "rewritten");
    const reviewed = await f.tip(f.local, "refs/remotes/origin/main");

    await Effect.runPromise(
      f.push("main", undefined, {
        mode: { _tag: "ForceWithLease", expectedOid: reviewed },
      }),
    );

    expect(await f.tip(f.remote, "refs/heads/main")).toBe(rewritten);
  });

  it("rejects a force push when a second writer moved the remote after review", async () => {
    const f = await fixture();
    const reviewed = await f.tip(f.local, "refs/remotes/origin/main");
    await git(f.local, "commit", "--amend", "--allow-empty", "-m", "rewritten");
    const theirs = await commit(f.other, "their work");
    await git(f.other, "push", "origin", "main");

    expect(
      await f.failure(
        f.push("main", undefined, {
          mode: { _tag: "ForceWithLease", expectedOid: reviewed },
        }),
      ),
    ).toMatchObject({ reason: "LeaseRejected" });
    expect(await f.tip(f.remote, "refs/heads/main")).toBe(theirs);
  });

  it("reports a remote hook rejection with the hook's message", async () => {
    const f = await fixture();
    const hook = join(f.remote, "hooks", "pre-receive");
    await writeFile(
      hook,
      "#!/bin/sh\necho 'name must match JIRA-123' >&2\nexit 1\n",
    );
    await chmod(hook, 0o755);
    await commit(f.local, "unreviewed");

    const rejected = await f.failure(f.push("main"));

    expect(rejected).toMatchObject({ reason: "HookDeclined" });
    expect(JSON.stringify(rejected)).toContain("name must match JIRA-123");
  });

  it("rejects a remote that does not exist", async () => {
    const f = await fixture();

    expect(
      await f.failure(
        f.push("main", { remote: "--upload-pack=x", branch: "main" }),
      ),
    ).toMatchObject({ reason: "RemoteMissing" });
  });

  it("reconciles the tracking branch when the push result is lost", async () => {
    const f = await fixture((runner) => ({
      ...runner,
      run: (command) =>
        command.arguments[0] === "push"
          ? runner
              .run({
                ...command,
                arguments: [
                  "push",
                  f.remote,
                  "refs/heads/main:refs/heads/main",
                ],
              })
              .pipe(
                Effect.andThen(
                  Effect.fail(new GitCommandError({ reason: "Timeout" })),
                ),
              )
          : runner.run(command),
    }));
    const pushed = await commit(f.local, "arrived");

    expect(await f.failure(f.push("main"))).toMatchObject({
      reason: "Uncertain",
      detail: expect.stringContaining(pushed.slice(0, 8)),
    });
    expect(await f.tip(f.local, "refs/remotes/origin/main")).toBe(pushed);
  });

  it("reconciles the tracking branch after a cancelled push", async () => {
    let arrived: () => void = () => undefined;
    const pushStarted = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const f = await fixture((runner) => ({
      ...runner,
      run: (command) =>
        command.arguments[0] === "push"
          ? runner
              .run({
                ...command,
                arguments: [
                  "push",
                  f.remote,
                  "refs/heads/main:refs/heads/main",
                ],
              })
              .pipe(
                Effect.tap(() => Effect.sync(arrived)),
                Effect.andThen(Effect.never),
              )
          : runner.run(command),
    }));
    const pushed = await commit(f.local, "arrived");

    const fiber = Effect.runFork(f.push("main"));
    await pushStarted;
    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(await f.tip(f.local, "refs/remotes/origin/main")).toBe(pushed);
  });
});
