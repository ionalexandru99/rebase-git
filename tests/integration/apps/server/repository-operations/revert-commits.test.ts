import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import { createRevertRepository } from "#tests-support/git.ts";
import { openTestEnvironment } from "#tests-support/server.ts";

async function fixture() {
  const environment = await openTestEnvironment();
  const { directory, git } = await createRevertRepository(environment.home);
  const repositoryId = (await environment.remember(directory)).id;
  const service = environment.routes(RepositoryOperationsApi);
  const scope = { repositoryId, worktreePath: directory };
  const output = async (...args: string[]) =>
    (await git(...args)).stdout.trim();
  return {
    directory,
    output,
    oid: (revision: string) => output("rev-parse", revision),
    file: (path: string) =>
      readFile(join(directory, path), "utf8").catch(() => null),
    revert: async (commits: readonly string[], commit = true) =>
      Effect.runPromise(
        service.start({
          ...scope,
          expectedHead: await output("rev-parse", "HEAD"),
          operation: { _tag: "Revert", commits, commit },
        }),
      ),
    abort: async () =>
      Effect.runPromise(
        service.execute({
          ...scope,
          revision: (await Effect.runPromise(service.read(scope))).revision,
          action: "abort",
        }),
      ),
  };
}

describe("revert commits", () => {
  it("adds one revert commit per selection on top of the unchanged history", async () => {
    const f = await fixture();
    const head = await f.oid("HEAD");
    const [changeA, addB] = [await f.oid("HEAD~3"), await f.oid("HEAD~4")];

    const { outcome, operation } = await f.revert([changeA, addB]);

    expect(outcome).toBe("Committed");
    expect(operation.kind).toBe("idle");
    expect(await f.output("log", "--format=%s", "-2")).toBe(
      'Revert "add b"\nRevert "change a"',
    );
    expect(await f.oid("HEAD~2")).toBe(head);
    expect(await f.file("a.txt")).toBe("a\n");
    expect(await f.file("b.txt")).toBeNull();
  });

  it("reverts a merge against its first parent", async () => {
    const f = await fixture();

    await f.revert([await f.oid("HEAD~2")]);

    expect(await f.output("log", "--format=%s", "-1")).toBe(
      'Revert "Merge side"',
    );
    expect(await f.file("c.txt")).toBeNull();
    expect(await f.file("a.txt")).toBe("a2\n");
  });

  it("stages the undo without committing", async () => {
    const f = await fixture();
    const head = await f.oid("HEAD");

    const started = await f.revert([await f.oid("HEAD~4")], false);

    expect(started).toMatchObject({
      outcome: "Staged",
      operation: { kind: "revert", phase: "ready" },
    });
    expect(await f.oid("HEAD")).toBe(head);
    expect(await f.output("diff", "--cached", "--name-status")).toBe(
      "D\tb.txt",
    );
  });

  it("hands a conflict to the operation lifecycle and aborts back to the start", async () => {
    const f = await fixture();
    const head = await f.oid("HEAD");

    const started = await f.revert([await f.oid("HEAD~1")]);

    expect(started).toMatchObject({
      outcome: "Stopped",
      operation: {
        kind: "revert",
        phase: "conflicts",
        unresolvedPaths: ["file.txt"],
      },
    });
    expect((await f.abort()).kind).toBe("idle");
    expect(await f.oid("HEAD")).toBe(head);
  });

  it("reports a hook that stops the revert and leaves it for recovery", async () => {
    const f = await fixture();
    await writeFile(
      join(f.directory, ".git", "hooks", "prepare-commit-msg"),
      "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n",
      { mode: 0o755 },
    );

    await expect(
      f.revert([await f.oid("HEAD~3"), await f.oid("HEAD~4")]),
    ).rejects.toMatchObject({ reason: "HookFailed" });

    expect((await f.abort()).kind).toBe("idle");
  });

  it("rejects an already undone commit and a commit outside the branch", async () => {
    const f = await fixture();
    const addB = await f.oid("HEAD~4");
    await f.revert([addB]);
    const head = await f.oid("HEAD");

    await expect(f.revert([addB])).rejects.toMatchObject({ reason: "Empty" });
    await expect(f.revert([await f.oid("elsewhere")])).rejects.toMatchObject({
      reason: "Incompatible",
    });
    expect(await f.oid("HEAD")).toBe(head);
  });
});
