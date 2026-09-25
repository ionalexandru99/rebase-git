import type { RepositoryRefs } from "@rebase/contracts";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { RepositoryBranchesClient } from "#web/features/branch-management/branch-management.contract";
import {
  createBranchManagement,
  RepositoryBranchesRejected,
} from "#web/features/branch-management/index";

const repositoryId = "00000000-0000-4000-8000-000000000001";
const worktreePath = "/repo";
const main = "a".repeat(40);
const topic = "b".repeat(40);
const scope = { repositoryId, worktreePath };

describe("branch management", () => {
  it("patches cached refs after each successful write", async () => {
    const { branches, current } = setup({
      create: () => Effect.succeed({ name: "next", target: main }),
      delete: () =>
        Effect.succeed({
          local: { name: "topic", target: topic },
          remote: { name: "topic", remote: "origin", target: topic },
        }),
      rename: () =>
        Effect.succeed({
          branch: { name: "trunk", target: main, worktreePath },
          previousName: "main",
        }),
    });

    await branches.create({ ...scope, name: "next", startPoint: main });
    await branches.rename({
      ...scope,
      expectedTarget: main,
      name: "main",
      newName: "trunk",
    });
    await branches.delete({
      ...scope,
      force: false,
      local: { name: "topic", target: topic },
      remote: { name: "topic", remote: "origin", target: topic },
    });

    expect(current().branches.map(({ name }) => name)).toEqual([
      "trunk",
      "next",
    ]);
    expect(current().worktrees[0]?.head.branch).toBe("trunk");
    expect(current().remoteBranches).toEqual([
      { name: "main", remote: "origin", target: main },
    ]);
  });

  it("leaves cached refs untouched when the Environment rejects a write", async () => {
    const rejected = new RepositoryBranchesRejected({
      failure: { _tag: "BranchExists", name: "topic" },
      status: 409,
    });
    const { branches, current } = setup({
      create: () => Effect.fail(rejected),
    });
    const before = current();

    await expect(
      branches.create({ ...scope, name: "topic", startPoint: main }),
    ).rejects.toBe(rejected);
    expect(current()).toBe(before);
  });
});

function setup(client: Partial<RepositoryBranchesClient>) {
  let refs: RepositoryRefs = {
    branches: [
      { name: "main", target: main, worktreePath },
      { name: "topic", target: topic },
    ],
    remoteBranches: [
      { name: "main", remote: "origin", target: main },
      { name: "topic", remote: "origin", target: topic },
    ],
    repositoryId,
    tags: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      {
        head: { branch: "main", commit: main },
        main: true,
        path: worktreePath,
      },
    ],
  };
  const branches = createBranchManagement(client as RepositoryBranchesClient, {
    apply: (id, change) => {
      if (id === repositoryId) refs = change(refs);
    },
  });
  return { branches, current: () => refs };
}
