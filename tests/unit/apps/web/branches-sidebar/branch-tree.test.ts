import { describe, expect, it } from "vite-plus/test";
import { repositoryRefs, worktree } from "#tests-support/fixtures.ts";
import {
  buildBranchesSidebarRows,
  defaultExpandedSections,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";

const refs = repositoryRefs({
  branches: [
    { name: "feature/api/current", worktreePath: "/repo" },
    { name: "feature/api/other" },
    { name: "bugfix/login", worktreePath: "/linked" },
    { name: "main" },
  ],
  remoteBranches: [{ name: "feature/api/current", remote: "origin" }],
  tags: [{ name: "release/v1" }],
  worktrees: [
    worktree("/repo", "feature/api/current"),
    worktree("/linked", "bugfix/login"),
  ],
});

function tree(query = "", folders: ReadonlyMap<string, boolean> = new Map()) {
  return buildBranchesSidebarRows(
    refs,
    "/repo",
    defaultExpandedSections,
    query,
    "all",
    { view: "tree", folders },
  );
}

describe("branch prefix tree", () => {
  it("sorts folders before individual branches at every level", () => {
    const rows = buildBranchesSidebarRows(
      {
        ...refs,
        branches: [
          { name: "alpha/zero" },
          { name: "main" },
          { name: "zeta/leaf" },
          { name: "alpha/nested/z" },
          { name: "alpha/beta" },
          { name: "alpha/nested/a" },
        ],
      },
      "/repo",
      defaultExpandedSections,
      "",
      "all",
      {
        view: "tree",
        folders: new Map([
          ["folder:branches:alpha", true],
          ["folder:branches:alpha/nested", true],
          ["folder:branches:zeta", true],
        ]),
      },
    );
    expect(
      rows
        .filter((row) => row.kind === "ref" || row.kind === "folder")
        .map((row) => row.label),
    ).toEqual([
      "alpha",
      "nested",
      "a",
      "z",
      "beta",
      "zero",
      "zeta",
      "leaf",
      "main",
    ]);
  });

  it("opens current ancestors and retains full checkout targets and stable ref IDs", () => {
    const rows = tree();
    expect(rows.map((row) => row.id)).toEqual([
      "section:branches",
      "folder:branches:bugfix",
      "folder:branches:feature",
      "folder:branches:feature/api",
      "ref:branches:feature/api/current",
      "ref:branches:feature/api/other",
      "ref:branches:main",
      "section:remote:origin",
      "section:tags",
    ]);
    expect(rows[4]).toMatchObject({
      name: "feature/api/current",
      label: "current",
      level: 4,
      parentId: "folder:branches:feature/api",
      target: { _tag: "LocalBranch", name: "feature/api/current" },
      checkout: { kind: "repository" },
    });
    expect(rows[1]).toMatchObject({
      expanded: false,
      label: "bugfix",
      level: 2,
    });
  });

  it("respects folder collapse and reveals every matching ancestor during search", () => {
    const folders = new Map([["folder:branches:feature", false]]);
    expect(
      tree("", folders).some(
        (row) => row.id === "ref:branches:feature/api/current",
      ),
    ).toBe(false);
    const rows = tree("API/other", folders);
    expect(rows.map((row) => row.id)).toEqual([
      "section:branches",
      "folder:branches:feature",
      "folder:branches:feature/api",
      "ref:branches:feature/api/other",
    ]);
    expect(rows.at(-1)).toMatchObject({ position: 1, setSize: 1 });
  });

  it("keeps remote and tag folders separate from local folders", () => {
    const rows = buildBranchesSidebarRows(
      refs,
      "/repo",
      new Set(["branches", "remote:origin", "tags"]),
      "",
      "all",
      {
        view: "tree",
        folders: new Map([
          ["folder:remote:origin:feature", true],
          ["folder:remote:origin:feature/api", true],
          ["folder:tags:release", true],
        ]),
      },
    );
    expect(
      rows.find((row) => row.id === "ref:remote:origin:feature/api/current"),
    ).toMatchObject({
      target: {
        _tag: "RemoteBranch",
        remote: "origin",
        name: "feature/api/current",
      },
      parentId: "folder:remote:origin:feature/api",
    });
    expect(rows.find((row) => row.id === "ref:tags:release/v1")).toMatchObject({
      target: { _tag: "Tag", name: "release/v1" },
    });
    expect(
      rows.filter((row) => row.kind === "section").map((row) => row.separator),
    ).toEqual([false, true, true]);
  });
});
