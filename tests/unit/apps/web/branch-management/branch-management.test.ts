import type { RepositoryRefs } from "@rebase/contracts";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";
import type {
  BranchWrites,
  RepositoryBranchesClient,
} from "#web/features/branch-management/branch-management.contract";
import { createBranchWrites } from "#web/features/branch-management/branch-writes";
import { RepositoryBranchesRejected } from "#web/features/branch-management/index";
import { createRepositoryBranches } from "#web/features/branch-management/repository-branches";

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

describe("repository branches", () => {
  it("checks out a created branch in the scoped worktree", async () => {
    const writes = fakeWrites();
    const checkout = vi.fn(async () => ({}) as never);
    const branches = createRepositoryBranches(writes, { checkout }, scope);

    await branches.actions.create({
      checkout: true,
      name: "next",
      startPoint: main,
    });

    expect(writes.create).toHaveBeenCalledWith({
      ...scope,
      name: "next",
      startPoint: main,
    });
    expect(checkout).toHaveBeenCalledWith(worktreePath, {
      _tag: "LocalBranch",
      name: "next",
    });
  });

  it("announces a rename only after the Environment accepts it", async () => {
    const writes = fakeWrites();
    const branches = createRepositoryBranches(
      writes,
      { checkout: vi.fn() },
      scope,
    );
    const renamed = vi.fn();
    const stop = branches.onRenamed(renamed);
    const rename = { name: "main", newName: "trunk" };

    writes.rename.mockRejectedValueOnce(new Error("Rejected"));
    await expect(branches.actions.rename(rename)).rejects.toThrow("Rejected");
    expect(renamed).not.toHaveBeenCalled();

    await branches.actions.rename(rename);
    expect(renamed).toHaveBeenCalledWith(rename);

    stop();
    await branches.actions.rename(rename);
    expect(renamed).toHaveBeenCalledOnce();
  });
});

function fakeWrites() {
  return {
    create: vi.fn<BranchWrites["create"]>(async () => ({
      name: "next",
      target: main,
    })),
    delete: vi.fn<BranchWrites["delete"]>(async () => ({})),
    rename: vi.fn<BranchWrites["rename"]>(async () => ({
      branch: { name: "trunk", target: main },
      previousName: "main",
    })),
    setUpstream: vi.fn<BranchWrites["setUpstream"]>(async () => ({
      name: "main",
      target: main,
    })),
  };
}

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
  const branches = createBranchWrites(client as RepositoryBranchesClient, {
    apply: (id, change) => {
      if (id === repositoryId) refs = change(refs);
    },
  });
  return { branches, current: () => refs };
}
