import type { RepositoryRefs } from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import { branchRowActions } from "#web/features/branches-sidebar/branch-editing/branch-row-actions";
import type { BranchesSidebarRefRow } from "#web/features/branches-sidebar/branches-sidebar.contract";
import { buildBranchesSidebarRows } from "#web/features/branches-sidebar/branches-sidebar-state";

const mainPath = "/repo";
const topicPath = "/repo/.worktrees/topic";
const commit = "a".repeat(40);

describe("branch row actions", () => {
  it("explains why a checked-out branch cannot be renamed or deleted", () => {
    expect(reasons("main")).toEqual({
      delete: "Checked out",
      newBranch: undefined,
      rename: undefined,
      upstream: undefined,
    });
    expect(reasons("topic")).toEqual({
      delete: "In another worktree",
      newBranch: undefined,
      rename: "In another worktree",
      upstream: undefined,
    });
    expect(reasons("feature")).toEqual({
      delete: undefined,
      newBranch: undefined,
      rename: undefined,
      upstream: undefined,
    });
  });

  it("offers deleting the local branch, its remote branch, or both", () => {
    expect(reasons("release")).toEqual({
      delete: undefined,
      deleteBoth: undefined,
      deleteRemote: undefined,
      newBranch: undefined,
      rename: undefined,
      upstream: undefined,
    });
    expect(reasons("origin/release")).toEqual({
      deleteRemote: undefined,
      newBranch: undefined,
    });
  });

  it("never offers deleting a differently named upstream such as a shared main", () => {
    expect(Object.keys(reasons("tracked"))).toEqual([
      "newBranch",
      "rename",
      "upstream",
      "delete",
    ]);
  });

  it("disables every write without repository write access", () => {
    expect(reasons("feature", false)).toEqual({
      delete: "Read only",
      newBranch: "Read only",
      rename: "Read only",
      upstream: "Read only",
    });
  });
});

function reasons(name: string, writable = true) {
  const repository = refs();
  const row = buildBranchesSidebarRows(
    repository,
    mainPath,
    new Set(["branches", "remote:origin"]),
    "",
  ).find(
    (candidate): candidate is BranchesSidebarRefRow =>
      candidate.kind === "ref" &&
      (candidate.target._tag === "RemoteBranch"
        ? `${candidate.target.remote}/${candidate.name}`
        : candidate.name) === name,
  );
  if (row === undefined) throw new Error(`Missing row ${name}`);
  return Object.fromEntries(
    branchRowActions(row, repository, mainPath, writable).map((action) => [
      action.id,
      action.disabledReason,
    ]),
  );
}

function refs(): RepositoryRefs {
  return {
    branches: [
      { name: "main", target: commit, worktreePath: mainPath },
      { name: "feature", target: commit },
      { name: "topic", target: commit, worktreePath: topicPath },
      {
        name: "tracked",
        target: commit,
        upstream: { ahead: 0, behind: 0, gone: false, name: "origin/release" },
      },
      {
        name: "release",
        target: commit,
        upstream: { ahead: 0, behind: 0, gone: false, name: "origin/release" },
      },
    ],
    remoteBranches: [{ name: "release", remote: "origin", target: commit }],
    repositoryId: "00000000-0000-4000-8000-000000000001",
    tags: [],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      { head: { branch: "main", commit }, main: true, path: mainPath },
      { head: { branch: "topic", commit }, main: false, path: topicPath },
    ],
  };
}
