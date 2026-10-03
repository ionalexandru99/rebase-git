import { describe, expect, it } from "vite-plus/test";
import type { RepositoryRefs } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  commitId,
  mainAndTopicWorktrees,
  mainPath,
  repositoryRefs,
  topicPath,
  upstream,
} from "#tests-support/fixtures.ts";
import { everyAction } from "#web/components/ui/action-menu.tsx";
import {
  type BranchesSidebarRefRow,
  buildBranchesSidebarRows,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";
import {
  type RefActionHandlers,
  refActions,
} from "#web/features/refs/ref-actions.ts";

describe("ref actions", () => {
  it("offers no checkout of the current branch and explains why it cannot be deleted", () => {
    expect(reasons("main")).toEqual({
      deleteLocal: "Checked out",
      newBranch: undefined,
      rename: undefined,
    });
    expect(reasons("topic")).toEqual({
      checkout: undefined,
      deleteLocal: "In another worktree",
      newBranch: undefined,
      rename: "In another worktree",
    });
    expect(reasons("feature")).toEqual({
      checkout: undefined,
      deleteLocal: undefined,
      newBranch: undefined,
      rename: undefined,
    });
  });

  it("offers deleting the local branch, its remote branch, or both", () => {
    expect(reasons("release")).toEqual({
      checkout: undefined,
      delete: undefined,
      deleteLocal: undefined,
      "deleteOn:origin": undefined,
      deleteBoth: undefined,
      newBranch: undefined,
      rename: undefined,
    });
    expect(reasons("origin/release")).toEqual({
      checkout: undefined,
      "deleteOn:origin": undefined,
      newBranch: undefined,
    });
  });

  it("never offers deleting a differently named upstream such as a shared main", () => {
    expect(Object.keys(reasons("tracked"))).toEqual([
      "checkout",
      "newBranch",
      "newWorktree",
      "rename",
      "deleteLocal",
    ]);
  });

  it("pushes or deletes a tag on each remote and offers both only with one remote", () => {
    expect(reasons("v1.0")).toEqual({
      checkout: undefined,
      newBranch: undefined,
      "pushTag:origin": undefined,
      delete: undefined,
      deleteLocal: undefined,
      "deleteOn:origin": undefined,
      deleteBoth: undefined,
    });
    expect(
      Object.keys(
        reasons("v1.0", true, [
          { remote: "origin", provider: "github" },
          { remote: "upstream", provider: "git" },
        ]),
      ),
    ).toEqual([
      "checkout",
      "newBranch",
      "pushTags",
      "pushTag:origin",
      "pushTag:upstream",
      "delete",
      "deleteLocal",
      "deleteOn:origin",
      "deleteOn:upstream",
    ]);
    expect(reasons("v1.0", true, [])).toMatchObject({
      "pushTag:": "No remotes",
    });
  });

  it("fast-forwards a branch that is not checked out unless it has diverged", () => {
    expect(pullAction("main", { ahead: 1 })).toMatchObject({
      label: "Pull",
      enabled: true,
    });
    expect(pullAction("feature", { ahead: 0 })).toMatchObject({
      label: "Fast-forward",
      enabled: true,
    });
    expect(pullAction("feature", { ahead: 1 })).toMatchObject({
      label: "Fast-forward",
      enabled: false,
      reason: "Diverged",
    });
  });

  it("disables every write without repository write access", () => {
    expect(reasons("feature", false)).toEqual({
      checkout: undefined,
      deleteLocal: "Read only",
      newBranch: "Read only",
      newWorktree: "Read only",
      rename: "Read only",
    });
    expect(reasons("release", false)).toMatchObject({ delete: "Read only" });
  });
});

function reasons(
  name: string,
  writable = true,
  remoteProviders: RepositoryRefs["remoteProviders"] = [
    { remote: "origin", provider: "git" },
  ],
) {
  const repository = { ...refs(), remoteProviders };
  const row = buildBranchesSidebarRows(
    repository,
    mainPath,
    new Set(["branches", "remote:origin", "tags"]),
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
    everyAction(
      refActions(
        row,
        repository,
        { activeWorktreePath: mainPath, writable },
        handlers,
      ),
    ).map((action) => [action.id, action.reason]),
  );
}

function pullAction(name: string, { ahead }: { readonly ahead: number }) {
  const tracked = upstream(`origin/${name}`, { ahead, behind: 1 });
  const repository = repositoryRefs({
    branches: [
      {
        name,
        target: commitId,
        upstream: tracked,
        ...(name === "main" ? { worktreePath: mainPath } : {}),
      },
    ],
    worktrees: mainAndTopicWorktrees(),
  });
  return refActions(
    {
      id: name,
      name,
      target: { _tag: "LocalBranch", name },
      upstream: tracked,
    },
    repository,
    { activeWorktreePath: mainPath, writable: true },
    { ...handlers, pull: { pulling: false, run: () => undefined } },
  ).find((action) => action.id === "pull");
}

const handlers: RefActionHandlers = {
  checkout: () => undefined,
  pull: undefined,
  pushTags: { pushing: false, run: () => undefined },
  editing: {
    draft: () => undefined,
    startRename: () => undefined,
    deletion: { request: () => undefined },
  },
};

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
    tags: [{ name: "v1.0", target: commitId }],
    worktrees: mainAndTopicWorktrees(),
  });
}
