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
    git(directory, "log", "--format=%s|%an", "topic~0", "--not", "main~2");
  return { directory, tip, step, start, execute, log };
}

describe("Rebase with an edited plan", () => {
  it("rewords, squashes into one message and reorders without opening an editor", async () => {
    const f = await fixture();
    expect(
      (
        await f.start([
          f.step("shared", "reword", "#12 Shared change, reworded"),
          f.step("one", "pick", "One and file\n\nFolded together"),
          f.step("file", "squash"),
        ])
      ).outcome,
    ).toBe("Rebased");
    expect(await f.log()).toBe(
      "One and file|Rebase test\n#12 Shared change, reworded|Rebase test",
    );
    expect(await git(f.directory, "log", "-1", "--format=%b", "topic")).toBe(
      "Folded together",
    );
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      "topic\n",
    );
  });

  it("drops a commit and folds a fixup into the commit below it, whatever sequence editor the environment names", async () => {
    const f = await fixture();
    process.env.GIT_SEQUENCE_EDITOR = "true";
    try {
      await f.start([
        f.step("shared", "pick"),
        f.step("file", "fixup"),
        f.step("one", "drop"),
      ]);
    } finally {
      delete process.env.GIT_SEQUENCE_EDITOR;
    }
    expect(await f.log()).toBe("shared change|Rebase test");
    expect(
      await git(f.directory, "ls-files", "one.txt", "file.txt", "shared.txt"),
    ).toBe("file.txt\nshared.txt");
  });

  it("drops commits that are not next to each other and keeps the rest", async () => {
    const f = await fixture();
    await f.start([
      f.step("one", "drop"),
      f.step("file", "pick"),
      f.step("shared", "drop"),
    ]);
    expect(await f.log()).toBe("topic file|Rebase test");
    expect(await readFile(join(f.directory, "file.txt"), "utf8")).toBe(
      "topic\n",
    );
    expect(await readFile(join(f.directory, "shared.txt"), "utf8")).toBe(
      "base\n",
    );
    expect(await git(f.directory, "ls-files", "one.txt")).toBe("");
  });

  it("leaves the branch at the base when every commit above it is dropped", async () => {
    const f = await fixture();
    await f.start([
      f.step("one", "drop"),
      f.step("file", "drop"),
      f.step("shared", "drop"),
    ]);
    expect(await f.tip("topic")).toBe(await f.tip("main~2"));
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
          { action: "edit", subject: "topic one", done: true },
          { action: "pick", subject: "File, reworded", done: false },
          { action: "pick", subject: "shared change", done: false },
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

  it("keeps a new message with its commit when Git drops that commit as already applied", async () => {
    const f = await fixture();
    await f.start(
      [
        f.step("one", "pick"),
        f.step("file", "drop"),
        f.step("shared", "reword", "Shared, reworded"),
      ],
      { ref: "main", commit: await f.tip("main") },
    );
    expect(await git(f.directory, "log", "--format=%s", "main..topic")).toBe(
      "topic one",
    );
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
