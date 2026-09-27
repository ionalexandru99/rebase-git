import { describe, expect, it } from "vite-plus/test";
import {
  commitId,
  mainAndTopicWorktrees,
  mainPath,
  repositoryRefs,
  topicPath,
  upstream,
} from "#tests-support/fixtures.ts";
import {
  type BranchesSidebarRefRow,
  buildBranchesSidebarRows,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";
import { refActions } from "#web/features/refs/ref-actions.ts";

describe("ref actions", () => {
  it("explains why a checked-out branch cannot be renamed or deleted", () => {
    expect(reasons("main")).toEqual({
      checkout: undefined,
      delete: "Checked out",
      newBranch: undefined,
      rename: undefined,
      upstream: undefined,
    });
    expect(reasons("topic")).toEqual({
      checkout: undefined,
      delete: "In another worktree",
      newBranch: undefined,
      rename: "In another worktree",
      upstream: undefined,
    });
    expect(reasons("feature")).toEqual({
      checkout: undefined,
      delete: undefined,
      newBranch: undefined,
      rename: undefined,
      upstream: undefined,
    });
  });

  it("offers deleting the local branch, its remote branch, or both", () => {
    expect(reasons("release")).toEqual({
      checkout: undefined,
      delete: undefined,
      deleteBoth: undefined,
      deleteRemote: undefined,
      newBranch: undefined,
      rename: undefined,
      upstream: undefined,
    });
    expect(reasons("origin/release")).toEqual({
      checkout: undefined,
      deleteRemote: undefined,
      newBranch: undefined,
    });
  });

  it("never offers deleting a differently named upstream such as a shared main", () => {
    expect(Object.keys(reasons("tracked"))).toEqual([
      "checkout",
      "newBranch",
      "rename",
      "upstream",
      "delete",
    ]);
  });

  it("disables every write without repository write access", () => {
    expect(reasons("feature", false)).toEqual({
      checkout: undefined,
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
    refActions(
      row,
      repository,
      { activeWorktreePath: mainPath, writable },
      {
        checkout: () => undefined,
        pull: undefined,
        editing: {
          draft: () => undefined,
          change: () => undefined,
          deletion: { request: () => undefined },
        },
      },
    ).map((action) => [action.id, action.reason]),
  );
}

function refs() {
  return repositoryRefs({
    branches: [
      { name: "main", target: commitId, worktreePath: mainPath },
      { name: "feature", target: commitId },
      { name: "topic", target: commitId, worktreePath: topicPath },
      {
        name: "tracked",
        target: commitId,
        upstream: upstream("origin/release"),
      },
      {
        name: "release",
        target: commitId,
        upstream: upstream("origin/release"),
      },
    ],
    remoteBranches: [{ name: "release", remote: "origin", target: commitId }],
    worktrees: mainAndTopicWorktrees(),
  });
}
