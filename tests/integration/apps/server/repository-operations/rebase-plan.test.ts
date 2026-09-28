import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  type PlanStep,
  RepositoryOperationsApi,
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
  const [one, file, shared] = await Promise.all(
    ["topic~2", "topic~1", "topic"].map(tip),
  );
  const commits = { one, file, shared } as Record<
    "one" | "file" | "shared",
    string
  >;
  const step = (
    name: keyof typeof commits,
    action: PlanStep["action"],
    message: string | null = null,
  ): PlanStep => ({ commit: commits[name], action, message });
  const base = { ref: null, commit: await tip("topic~3") };
  const start = async (
    plan: readonly PlanStep[],
    onto: { ref: string | null; commit: string } = base,
  ) =>
    Effect.runPromise(
      service.start({
        ...scope,
        expectedHead: await tip("HEAD"),
        operation: { _tag: "Rebase", onto, stash: false, plan },
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
  const log = () =>
    git(directory, "log", "--format=%s|%b|%an", "topic~0", "--not", "main~2");
  return { directory, tip, step, start, execute, log };
}

describe("Rebase with an edited plan", () => {
  it("rewords, squashes into one message and reorders without opening an editor", async () => {
    const f = await fixture();
    expect(
      (
        await f.start([
          f.step("shared", "reword", "Shared change, reworded"),
          f.step("one", "pick", "One and file\n\nFolded together"),
          f.step("file", "squash"),
        ])
      ).outcome,
    ).toBe("Rebased");
    expect(await f.log()).toBe(
      "One and file|Folded together|Rebase test\nShared change, reworded||Rebase test",
    );
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      "topic\n",
    );
  });

  it("drops a commit and folds a fixup into the commit below it", async () => {
    const f = await fixture();
    await f.start([
      f.step("shared", "pick"),
      f.step("file", "fixup"),
      f.step("one", "drop"),
    ]);
    expect(await f.log()).toBe("shared change||Rebase test");
    expect(
      await git(f.directory, "ls-files", "one.txt", "file.txt", "shared.txt"),
    ).toBe("file.txt\nshared.txt");
  });

  it("stops at an edit, reports the plan, and finishes through the shared lifecycle", async () => {
    const f = await fixture();
    const started = await f.start([
      f.step("one", "edit"),
      f.step("file", "reword", "File, reworded"),
      f.step("shared", "pick"),
    ]);
    expect(started).toMatchObject({
      outcome: "Stopped",
      operation: {
        kind: "rebase",
        phase: "edit",
        progress: { current: 1, total: 3 },
        steps: [
          { action: "edit", done: true },
          { action: "reword", done: false },
          { action: "pick", done: false },
        ],
      },
    });
    expect((await f.execute("continue")).kind).toBe("idle");
    expect(await git(f.directory, "log", "--format=%s", "-2")).toBe(
      "shared change\nFile, reworded",
    );
  });

  it("stops on a conflict and aborts back to the starting tip", async () => {
    const f = await fixture();
    const started = await f.tip("topic");
    expect(
      (
        await f.start(
          [
            f.step("one", "pick"),
            f.step("file", "pick"),
            f.step("shared", "drop"),
          ],
          { ref: "main", commit: await f.tip("main") },
        )
      ).operation.phase,
    ).toBe("conflicts");
    expect((await f.execute("abort")).kind).toBe("idle");
    expect(await f.tip("topic")).toBe(started);
  });

  it("refuses plans that miss a commit or fold into nothing, without running Git", async () => {
    const f = await fixture();
    const started = await f.tip("topic");
    await expect(
      f.start([f.step("one", "pick"), f.step("file", "pick")]),
    ).rejects.toMatchObject({ reason: "Stale" });
    await expect(
      f.start([
        f.step("one", "squash"),
        f.step("file", "pick"),
        f.step("shared", "pick"),
      ]),
    ).rejects.toMatchObject({ reason: "Incompatible" });
    await expect(
      f.start([
        f.step("one", "reword"),
        f.step("file", "pick"),
        f.step("shared", "pick"),
      ]),
    ).rejects.toMatchObject({ reason: "Incompatible" });
    expect(await f.tip("topic")).toBe(started);
  });
});
