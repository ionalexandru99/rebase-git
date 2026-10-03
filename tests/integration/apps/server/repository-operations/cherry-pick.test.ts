import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import {
  type OperationAction,
  RepositoryOperationsApi,
  type StartCherryPick,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import type { GitCommandRunner } from "#server/adapters/local-git/git-commands.ts";
import { createCherryPickRepository, git } from "#tests-support/git.ts";
import { interruptGit, openTestEnvironment } from "#tests-support/server.ts";

describe("Starting a cherry-pick", () => {
  it("applies the commits in the given order with the chosen merge parent", async () => {
    const { client, oids, directory } = await fixture();

    const operation = await client.start({
      commits: [oids.changeC, oids.mergeSide],
      mainline: 1,
      result: "commit",
    });

    expect(operation.kind).toBe("idle");
    expect(await subjects(directory, 3)).toEqual([
      "merge side",
      "change c",
      "release",
    ]);
    expect(await readFile(join(directory, "r.txt"), "utf8")).toBe("5\n");
  });

  it("stages every picked change without committing", async () => {
    const { client, oids, directory } = await fixture();
    const head = await git(directory, "rev-parse", "HEAD");

    await client.start({
      commits: [oids.changeC, oids.mergeSide],
      mainline: 1,
      result: "stage",
    });

    expect(await git(directory, "rev-parse", "HEAD")).toBe(head);
    expect(await git(directory, "diff", "--cached", "--name-only")).toBe(
      "c.txt\nr.txt",
    );
  });

  it("refuses a moved branch, a merge without a parent and staged changes for staging", async () => {
    const { client, oids, directory } = await fixture();

    await expect(
      client.start({
        commits: [oids.changeC],
        mainline: null,
        result: "commit",
        expectedHead: oids.base,
      }),
    ).rejects.toMatchObject({ _tag: "OperationFailed", reason: "Stale" });
    await expect(
      client.start({
        commits: [oids.mergeSide],
        mainline: null,
        result: "commit",
      }),
    ).rejects.toMatchObject({
      _tag: "OperationFailed",
      reason: "Incompatible",
    });
    await writeFile(join(directory, "c.txt"), "staged\n");
    await git(directory, "add", "c.txt");
    await expect(
      client.start({
        commits: [oids.changeB],
        mainline: null,
        result: "stage",
      }),
    ).rejects.toMatchObject({
      _tag: "OperationFailed",
      reason: "Incompatible",
    });
  });

  it("stops on a conflict, stops on an already applied commit and finishes after skip", async () => {
    const { client, oids, directory } = await fixture();

    const conflict = await client.start({
      commits: [oids.changeA, oids.changeB, oids.changeC],
      mainline: null,
      result: "commit",
    });
    expect(conflict).toMatchObject({
      kind: "cherry-pick",
      phase: "conflicts",
      unresolvedPaths: ["a.txt"],
      progress: { current: 1, total: 3 },
    });

    await writeFile(join(directory, "a.txt"), "a resolved\n");
    await git(directory, "add", "a.txt");
    const empty = await client.execute("continue");
    expect(empty).toMatchObject({
      kind: "cherry-pick",
      phase: "empty",
      progress: { current: 2, total: 3 },
    });
    expect(
      empty.actions.find(({ action }) => action === "continue")?.enabled,
    ).toBe(false);

    expect((await client.execute("skip")).kind).toBe("idle");
    expect(await subjects(directory, 3)).toEqual([
      "change c",
      "change a",
      "release",
    ]);
  });

  it("finishes a staged selection after a conflict with every picked change staged", async () => {
    const { client, oids, directory } = await fixture();
    const head = await git(directory, "rev-parse", "HEAD");

    const conflict = await client.start({
      commits: [oids.changeA, oids.changeC, oids.mergeSide],
      mainline: 1,
      result: "stage",
    });
    expect(conflict).toMatchObject({
      kind: "cherry-pick",
      phase: "conflicts",
    });
    expect(conflict.actions.map(({ action }) => action)).toEqual([
      "continue",
      "abort",
    ]);
    await writeFile(join(directory, "a.txt"), "a resolved\n");
    await git(directory, "add", "a.txt");

    expect((await client.execute("continue")).kind).toBe("idle");
    expect(await git(directory, "rev-parse", "HEAD")).toBe(head);
    expect(await git(directory, "diff", "--cached", "--name-only")).toBe(
      "a.txt\nc.txt\nr.txt",
    );
  });

  it("stops a single staged commit on a conflict that staging the resolution finishes", async () => {
    const { client, oids, directory } = await fixture();
    const head = await git(directory, "rev-parse", "HEAD");

    const conflict = await client.started({
      commits: [oids.changeA],
      mainline: null,
      result: "stage",
    });
    expect(conflict).toMatchObject({
      outcome: "Stopped",
      operation: { kind: "idle" },
    });
    await writeFile(join(directory, "a.txt"), "a resolved\n");
    await git(directory, "add", "a.txt");

    expect(await git(directory, "rev-parse", "HEAD")).toBe(head);
    expect(await git(directory, "diff", "--cached", "--name-only")).toBe(
      "a.txt",
    );
  });

  it("reports staging Git applied before it stopped as done and staging it never ran as a Git failure", async () => {
    const applied = await fixture(interruptGit("cherry-pick", true));
    await expect(
      applied.client.started({
        commits: [applied.oids.changeC],
        mainline: null,
        result: "stage",
      }),
    ).resolves.toMatchObject({ outcome: "Staged" });

    const untouched = await fixture(interruptGit("cherry-pick", false));
    await expect(
      untouched.client.started({
        commits: [untouched.oids.changeC],
        mainline: null,
        result: "stage",
      }),
    ).rejects.toMatchObject({
      _tag: "RepositoryRejected",
      reason: "GitFailed",
    });
    expect(await git(untouched.directory, "status", "--porcelain")).toBe("");
  });

  it("finishes a staged selection when Git stops after staging the rest", async () => {
    let interrupted = false;
    const { client, oids, directory } = await fixture((runner) => ({
      ...runner,
      run: (command) =>
        (interrupted
          ? interruptGit("cherry-pick --no-commit", true)(runner)
          : runner
        ).run(command),
    }));
    await client.start({
      commits: [oids.changeA, oids.changeC, oids.mergeSide],
      mainline: 1,
      result: "stage",
    });
    await writeFile(join(directory, "a.txt"), "a resolved\n");
    await git(directory, "add", "a.txt");
    interrupted = true;

    expect((await client.execute("continue")).kind).toBe("idle");
    expect(await git(directory, "diff", "--cached", "--name-only")).toBe(
      "a.txt\nc.txt\nr.txt",
    );
  });

  it("aborts back to the starting tip", async () => {
    const { client, oids, directory } = await fixture();
    const head = await git(directory, "rev-parse", "HEAD");
    await client.start({
      commits: [oids.changeC, oids.changeA],
      mainline: null,
      result: "commit",
    });

    expect((await client.execute("abort")).kind).toBe("idle");
    expect(await git(directory, "rev-parse", "HEAD")).toBe(head);
  });
});

async function fixture(wrap?: (runner: GitCommandRunner) => GitCommandRunner) {
  const environment = await openTestEnvironment({ git: wrap });
  const { directory, oids } = await createCherryPickRepository(
    environment.home,
  );
  const repositoryId = (await environment.remember(directory)).id;
  const scope = { repositoryId, worktreePath: directory };
  const operations = environment.routes(RepositoryOperationsApi);
  const expectedHead = await git(directory, "rev-parse", "HEAD");
  const read = () => Effect.runPromise(operations.read(scope));
  const started = (
    command: Omit<StartCherryPick, "_tag"> & {
      readonly expectedHead?: string;
    },
  ) =>
    Effect.runPromise(
      operations.start({
        ...scope,
        expectedHead: command.expectedHead ?? expectedHead,
        operation: {
          _tag: "CherryPick",
          commits: command.commits,
          mainline: command.mainline,
          result: command.result,
        },
      }),
    );
  return {
    directory,
    oids,
    client: {
      started,
      start: (
        command: Omit<StartCherryPick, "_tag"> & {
          readonly expectedHead?: string;
        },
      ) => started(command).then(({ operation }) => operation),
      execute: async (action: OperationAction) =>
        Effect.runPromise(
          operations.execute({
            ...scope,
            revision: (await read()).revision,
            action,
          }),
        ),
    },
  };
}

function subjects(directory: string, count: number) {
  return git(directory, "log", `-${count}`, "--format=%s").then((output) =>
    output.split("\n"),
  );
}
