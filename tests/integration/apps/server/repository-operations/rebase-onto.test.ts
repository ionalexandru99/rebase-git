import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  RepositoryOperationsApi,
  type StartRebase,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import { createRebaseRepository, git } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

async function fixture() {
  const environment = await openTestEnvironment();
  const directory = await createRebaseRepository(environment.home);
  const repositoryId = (await environment.remember(directory)).id;
  const service = environment.routes(RepositoryOperationsApi);
  const scope = { repositoryId, worktreePath: directory };
  const tip = (ref: string) => git(directory, "rev-parse", ref);
  const start = async ({
    expectedHead,
    ...overrides
  }: Partial<Omit<StartRebase, "_tag">> & { expectedHead?: string } = {}) =>
    Effect.runPromise(
      service.start({
        ...scope,
        expectedHead: expectedHead ?? (await tip("HEAD")),
        operation: {
          _tag: "Rebase",
          onto: { ref: "main", commit: await tip("main") },
          stash: false,
          ...overrides,
        },
      }),
    );
  const execute = async (action: "continue" | "abort") =>
    Effect.runPromise(
      service.execute({
        ...scope,
        revision: (await Effect.runPromise(service.read(scope))).revision,
        action,
      }),
    );
  return { directory, tip, start, execute };
}

describe("Rebase onto a target", () => {
  it("stops on a conflict, continues through the shared lifecycle and drops the change main already has", async () => {
    const f = await fixture();
    expect(await f.start()).toMatchObject({
      outcome: "Stopped",
      operation: {
        kind: "rebase",
        phase: "conflicts",
        branch: "topic",
        unresolvedPaths: ["file.txt"],
        progress: { current: 2, total: 2 },
      },
    });
    await writeFile(join(f.directory, "file.txt"), "resolved\n");
    await git(f.directory, "add", "file.txt");
    expect((await f.execute("continue")).kind).toBe("idle");
    expect(await git(f.directory, "log", "--format=%s", "main..topic")).toBe(
      "topic file\ntopic one",
    );
  });

  it("puts the branch back where it started on abort and restores stashed changes", async () => {
    const f = await fixture();
    const started = await f.tip("topic");
    await writeFile(join(f.directory, "one.txt"), "edited\n");
    expect((await f.start({ stash: true })).outcome).toBe("Stopped");
    expect((await f.execute("abort")).kind).toBe("idle");
    expect(await f.tip("topic")).toBe(started);
    expect(await readFile(join(f.directory, "one.txt"), "utf8")).toBe(
      "edited\n",
    );
  });

  it("keeps merges in the replayed range", async () => {
    const f = await fixture();
    await git(f.directory, "checkout", "merged");
    expect(await f.start()).toMatchObject({
      outcome: "Rebased",
      operation: { kind: "idle" },
    });
    expect(
      await git(f.directory, "rev-list", "--merges", "--count", "main..merged"),
    ).toBe("1");
  });

  it("reports stashed changes that conflict when Git puts them back", async () => {
    const f = await fixture();
    await git(f.directory, "checkout", "merged");
    await writeFile(join(f.directory, "shared.txt"), "mine\n");
    await expect(f.start({ stash: true })).rejects.toMatchObject({
      reason: "GitRejected",
      detail: expect.stringMatching(/resulted in conflicts/),
    });
    expect(
      await git(f.directory, "merge-base", "--is-ancestor", "main", "merged"),
    ).toBe("");
  });

  it("refuses without running Git when the branch, the target or the worktree changed", async () => {
    const f = await fixture();
    const started = await f.tip("topic");
    await expect(
      f.start({ expectedHead: await f.tip("main") }),
    ).rejects.toMatchObject({
      reason: "Stale",
    });
    await expect(
      f.start({ onto: { ref: "main", commit: await f.tip("main~1") } }),
    ).rejects.toMatchObject({ reason: "Stale" });
    await writeFile(join(f.directory, "one.txt"), "edited\n");
    await expect(f.start()).rejects.toMatchObject({ reason: "Stale" });
    expect(await f.tip("topic")).toBe(started);
  });

  it("reports a rejecting pre-rebase hook", async () => {
    const f = await fixture();
    const hook = join(f.directory, ".git", "hooks", "pre-rebase");
    await writeFile(hook, '#!/bin/sh\necho "pre-rebase: no" >&2\nexit 1\n');
    await chmod(hook, 0o755);
    await expect(f.start()).rejects.toMatchObject({ reason: "HookFailed" });
  });
});
