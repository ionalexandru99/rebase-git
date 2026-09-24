import { Effect, Stream } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { GitCommandRunner } from "#server/domain/git-command.contract";
import { createRepositoryAccess } from "#server/repository/access/index";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const repositoryPath = "/missing/rebase/repository";
const linkedPath = "/missing/rebase/linked";

describe("repository access", () => {
  it("reuses the worktree list until the repository changes", async () => {
    const repository = fakeRepository([repositoryPath]);
    const scope = { repositoryId, worktreePath: repositoryPath };

    await Effect.runPromise(repository.access.requireWorktree(scope));
    await Effect.runPromise(repository.access.requireWorktree(scope));
    const listedBeforeChange = repository.worktreeLists();
    repository.change();
    await Effect.runPromise(repository.access.requireWorktree(scope));

    expect(listedBeforeChange).toBe(1);
    expect(repository.worktreeLists()).toBe(2);
    expect(repository.closedWatches()).toBe(1);
  });

  it("reads the worktree list again before rejecting an unknown worktree", async () => {
    const repository = fakeRepository([repositoryPath]);
    await Effect.runPromise(
      repository.access.requireWorktree({
        repositoryId,
        worktreePath: repositoryPath,
      }),
    );

    repository.addWorktree(linkedPath);
    await Effect.runPromise(
      repository.access.requireWorktree({
        repositoryId,
        worktreePath: linkedPath,
      }),
    );
    const failure = await Effect.runPromise(
      Effect.flip(
        repository.access.requireWorktree({
          repositoryId,
          worktreePath: "/missing/rebase/elsewhere",
        }),
      ),
    );

    expect(repository.worktreeLists()).toBe(3);
    expect(failure.failure._tag).toBe("WorktreeMissing");
  });
});

function fakeRepository(initialWorktrees: readonly string[]) {
  const worktrees = [...initialWorktrees];
  const listeners: (() => void)[] = [];
  let worktreeLists = 0;
  let closedWatches = 0;
  const git: GitCommandRunner = {
    stream: () => Stream.empty,
    run: (command) =>
      Effect.sync(() => {
        if (command.arguments[0] !== "worktree")
          return {
            exitCode: 0,
            stderr: "",
            stdout: `${repositoryPath}/.git\n`,
          };
        worktreeLists++;
        return {
          exitCode: 0,
          stderr: "",
          stdout: worktrees
            .map((path) => `worktree ${path}\0HEAD ${"a".repeat(40)}\0\0`)
            .join(""),
        };
      }),
  };
  const access = createRepositoryAccess(
    {
      find: (id) =>
        Effect.succeed({
          id,
          name: "repository",
          path: repositoryPath,
          addedAt: "",
          lastOpenedAt: "",
        }),
    },
    git,
    {
      watch: (_directory, onChange) =>
        Effect.sync(() => {
          listeners.push(() => onChange("Refs"));
          return { close: () => closedWatches++ };
        }),
    },
  );
  return {
    access,
    addWorktree: (path: string) => worktrees.push(path),
    change: () => {
      for (const listener of listeners.splice(0)) listener();
    },
    closedWatches: () => closedWatches,
    worktreeLists: () => worktreeLists,
  };
}
