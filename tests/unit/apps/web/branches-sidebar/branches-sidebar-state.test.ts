import type { RepositoryRefs } from "@rebase/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildBranchesSidebarRows,
  defaultExpandedSections,
  resolveActiveWorktreePath,
  resolveRefSelection,
  stepRow,
  toggleSection,
} from "#web/features/branches-sidebar/branches-sidebar-state";

const commit = "a".repeat(40);
const mainPath = "/repo";
const topicPath = "/repo/.worktrees/topic";

describe("branches sidebar state", () => {
  it("expands local branches by default and keeps remotes and tags collapsed", () => {
    const rows = buildBranchesSidebarRows(
      refs(),
      mainPath,
      defaultExpandedSections,
      "",
    );

    expect(rows.map((row) => row.id)).toEqual([
      "section:branches",
      "ref:branches:main",
      "ref:branches:topic",
      "ref:branches:feature",
      "section:remote:origin",
      "section:remote:upstream",
      "section:tags",
    ]);
    expect(rows[1]).toMatchObject({ current: true, worktreePath: mainPath });
    expect(rows[2]).toMatchObject({ current: false, worktreePath: topicPath });
    expect(rows[4]).toMatchObject({
      count: 2,
      expanded: false,
      title: "origin",
    });
    expect(rows[6]).toMatchObject({ count: 1, expanded: false, title: "Tags" });
  });

  it("keeps the active branch ahead of branches in other worktrees", () => {
    const rows = buildBranchesSidebarRows(
      refs(),
      topicPath,
      defaultExpandedSections,
      "",
    );

    expect(rows.slice(1, 4).map((row) => row.id)).toEqual([
      "ref:branches:topic",
      "ref:branches:main",
      "ref:branches:feature",
    ]);
  });

  it("expands matching sections and hides empty ones while filtering", () => {
    const rows = buildBranchesSidebarRows(
      refs(),
      mainPath,
      defaultExpandedSections,
      "  FEAT ",
    );

    expect(rows.map((row) => row.id)).toEqual([
      "section:branches",
      "ref:branches:feature",
      "section:remote:origin",
      "ref:remote:origin:feature",
    ]);
  });

  it("switches worktrees for branches held elsewhere and checks out the rest", () => {
    const current = refs();

    expect(
      resolveRefSelection(current, mainPath, {
        _tag: "LocalBranch",
        name: "topic",
      }),
    ).toEqual({ _tag: "SwitchWorktree", worktreePath: topicPath });
    expect(
      resolveRefSelection(current, mainPath, {
        _tag: "LocalBranch",
        name: "main",
      }),
    ).toEqual({ _tag: "AlreadyCurrent" });
    expect(
      resolveRefSelection(current, mainPath, {
        _tag: "RemoteBranch",
        name: "topic",
        remote: "origin",
      }),
    ).toEqual({ _tag: "SwitchWorktree", worktreePath: topicPath });
    expect(
      resolveRefSelection(current, mainPath, {
        _tag: "RemoteBranch",
        name: "main",
        remote: "upstream",
      }),
    ).toEqual({
      _tag: "Checkout",
      target: { _tag: "RemoteBranch", name: "main", remote: "upstream" },
    });
    expect(
      resolveRefSelection(current, mainPath, {
        _tag: "RemoteBranch",
        name: "release",
        remote: "upstream",
      }),
    ).toEqual({
      _tag: "Checkout",
      target: { _tag: "RemoteBranch", name: "release", remote: "upstream" },
    });
    expect(
      resolveRefSelection(current, topicPath, { _tag: "Tag", name: "v1.0.0" }),
    ).toEqual({ _tag: "Checkout", target: { _tag: "Tag", name: "v1.0.0" } });
  });

  it("falls back to the main worktree when the preferred path disappeared", () => {
    expect(resolveActiveWorktreePath(refs(), topicPath)).toBe(topicPath);
    expect(resolveActiveWorktreePath(refs(), "/gone")).toBe(mainPath);
  });

  it("steps through rows without wrapping and toggles sections", () => {
    const rows = buildBranchesSidebarRows(
      refs(),
      mainPath,
      toggleSection(defaultExpandedSections, "tags"),
      "",
    );

    expect(stepRow(rows, undefined, 1)).toBe("section:branches");
    expect(stepRow(rows, undefined, -1)).toBe("ref:tags:v1.0.0");
    expect(stepRow(rows, "section:branches", -1)).toBe("section:branches");
    expect(stepRow(rows, "ref:branches:feature", 1)).toBe(
      "section:remote:origin",
    );
    expect(toggleSection(defaultExpandedSections, "branches").size).toBe(0);
  });
});

function refs(): RepositoryRefs {
  return {
    branches: [
      {
        name: "main",
        upstream: { ahead: 0, behind: 2, gone: false, name: "origin/main" },
        worktreePath: mainPath,
      },
      { name: "feature" },
      { name: "topic", worktreePath: topicPath },
    ],
    remoteBranches: [
      { name: "feature", remote: "origin" },
      { name: "topic", remote: "origin" },
      { name: "release", remote: "upstream" },
    ],
    repositoryId: "00000000-0000-4000-8000-000000000001",
    tags: [{ name: "v1.0.0" }],
    truncated: { branches: false, remoteBranches: false, tags: false },
    worktrees: [
      { head: { branch: "main", commit }, main: true, path: mainPath },
      { head: { branch: "topic", commit }, main: false, path: topicPath },
    ],
  };
}
