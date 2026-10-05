import { describe, expect, it } from "vite-plus/test";
import {
  branchScenarioRefs,
  mainPath,
  repositoryStash,
  topicPath,
} from "#tests-support/fixtures.ts";
import {
  type BranchesSidebarItem,
  branchesSidebarItems,
  buildBranchesSidebarRows,
  defaultExpandedSections,
  firstDockedIndex,
  selectRefRows,
  stepRow,
  toggleSection,
} from "#web/features/branches-sidebar/branches-sidebar-state.ts";

describe("branches sidebar state", () => {
  it("expands local branches by default and keeps remotes and tags collapsed", () => {
    const rows = buildBranchesSidebarRows(
      branchScenarioRefs(),
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
    expect(rows[1]).toMatchObject({
      current: true,
      checkout: { kind: "repository", path: mainPath },
    });
    expect(rows[2]).toMatchObject({
      current: false,
      checkout: { kind: "worktree", path: topicPath },
    });
    expect(rows[0]).toMatchObject({ count: 3, scope: "local" });
    expect(rows[4]).toMatchObject({
      count: 2,
      expanded: false,
      scope: "remote",
      title: "origin",
    });
    expect(rows[6]).toMatchObject({
      count: 1,
      expanded: false,
      scope: "tags",
      title: "Tags",
    });
  });

  it("docks every section after Local, with drafts staying in their own section", () => {
    const rows = buildBranchesSidebarRows(
      branchScenarioRefs(),
      mainPath,
      defaultExpandedSections,
      "",
    );
    const docked = (items: readonly BranchesSidebarItem[]) =>
      items.slice(firstDockedIndex(items)).map((item) => item.id);

    expect(docked(branchesSidebarItems(rows, "branches"))).toEqual([
      "section:remote:origin",
      "section:remote:upstream",
      "section:tags",
    ]);
    expect(docked(branchesSidebarItems(rows, "tags")).slice(-2)).toEqual([
      "section:tags",
      "ref-draft",
    ]);

    const remotes = buildBranchesSidebarRows(
      branchScenarioRefs(),
      mainPath,
      defaultExpandedSections,
      "",
      "remote",
    );
    expect(firstDockedIndex(branchesSidebarItems(remotes, undefined))).toBe(0);
  });

  it("moves settled branches out of Local into a Settled section docked above the remotes", () => {
    const current = branchScenarioRefs();
    const refs = {
      ...current,
      branches: current.branches.map((branch) =>
        branch.name === "feature"
          ? { ...branch, settled: "2026-10-01" }
          : branch,
      ),
    };
    const rows = buildBranchesSidebarRows(
      refs,
      mainPath,
      toggleSection(defaultExpandedSections, "settled"),
      "",
    );

    const items = branchesSidebarItems(rows, undefined);
    const dock = firstDockedIndex(items);
    expect(items.slice(0, dock).map((item) => item.id)).toEqual([
      "section:branches",
      "ref:branches:main",
      "ref:branches:topic",
    ]);
    expect(items.slice(dock, dock + 3).map((item) => item.id)).toEqual([
      "section:settled",
      "ref:settled:feature",
      "section:remote:origin",
    ]);
    expect(rows[3]).toMatchObject({ count: 1, scope: "settled" });
    const localRows = (expanded: ReadonlySet<string>) =>
      buildBranchesSidebarRows(refs, mainPath, expanded, "", "local").map(
        (row) => row.id,
      );
    expect(localRows(defaultExpandedSections)).toEqual([
      "section:branches",
      "ref:branches:main",
      "ref:branches:topic",
      "section:settled",
    ]);
    expect(
      localRows(toggleSection(defaultExpandedSections, "settled")).slice(3),
    ).toEqual(["section:settled", "ref:settled:feature"]);
  });

  it("keeps the active branch ahead of branches in other worktrees", () => {
    const rows = buildBranchesSidebarRows(
      branchScenarioRefs(),
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
      branchScenarioRefs(),
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

  it("shows only the selected ref scope and expands its sections", () => {
    expect(
      buildBranchesSidebarRows(
        branchScenarioRefs(),
        mainPath,
        defaultExpandedSections,
        "",
        "local",
      ).map((row) => row.id),
    ).toEqual([
      "section:branches",
      "ref:branches:main",
      "ref:branches:topic",
      "ref:branches:feature",
    ]);

    expect(
      buildBranchesSidebarRows(
        branchScenarioRefs(),
        mainPath,
        defaultExpandedSections,
        "",
        "remote",
      ).map((row) => row.id),
    ).toEqual([
      "section:remote:origin",
      "ref:remote:origin:feature",
      "ref:remote:origin:topic",
      "section:remote:upstream",
      "ref:remote:upstream:release",
    ]);

    const tags = buildBranchesSidebarRows(
      branchScenarioRefs(),
      mainPath,
      defaultExpandedSections,
      "",
      "tags",
    );
    expect(tags.map((row) => row.id)).toEqual([
      "section:tags",
      "ref:tags:v1.0.0",
    ]);
    expect(tags[0]).toMatchObject({ expanded: true });

    expect(
      buildBranchesSidebarRows(
        branchScenarioRefs(),
        mainPath,
        defaultExpandedSections,
        "feat",
        "remote",
      ).map((row) => row.id),
    ).toEqual(["section:remote:origin", "ref:remote:origin:feature"]);
  });

  it("selects local branches or tags by Ctrl and Shift without mixing the two", () => {
    const rows = buildBranchesSidebarRows(
      branchScenarioRefs(),
      mainPath,
      new Set(["branches", "remote:origin", "tags"]),
      "",
    );
    const main = "ref:branches:main";
    const feature = "ref:branches:feature";
    const tag = rows.find(
      (row) => row.kind === "ref" && row.target._tag === "Tag",
    )?.id;
    const remote = rows.find(
      (row) => row.kind === "ref" && row.target._tag === "RemoteBranch",
    )?.id;
    if (tag === undefined || remote === undefined)
      throw new Error("Missing rows");

    const range = selectRefRows(rows, new Set(), main, feature, "range");
    expect([...range]).toEqual([main, "ref:branches:topic", feature]);
    expect([...selectRefRows(rows, range, feature, tag, "toggle")]).toEqual([
      tag,
    ]);
    expect([
      ...selectRefRows(rows, new Set(), main, feature, "toggle"),
    ]).toEqual([main, feature]);
    expect(selectRefRows(rows, range, feature, remote, "toggle").size).toBe(0);
  });

  it("steps through rows without wrapping and toggles sections", () => {
    const rows = buildBranchesSidebarRows(
      branchScenarioRefs(),
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
    expect(
      toggleSection(defaultExpandedSections, "branches").has("branches"),
    ).toBe(false);
  });

  it("lists stashes collapsed after tags, filters them by name, and keeps the section while one is named", () => {
    const reflog = repositoryStash({ oid: "1".repeat(40), name: "Reflog" });
    const wip = repositoryStash({ oid: "2".repeat(40), name: "WIP on main" });
    const ids = (
      query: string,
      scope: "all" | "stashes",
      list = [reflog, wip],
      drafting = false,
    ) =>
      buildBranchesSidebarRows(
        branchScenarioRefs(),
        mainPath,
        defaultExpandedSections,
        query,
        scope,
        undefined,
        { list, drafting },
      ).map((row) => row.id);

    expect(ids("", "all").slice(-1)).toEqual(["section:stashes"]);
    expect(ids("", "stashes")).toEqual([
      "section:stashes",
      `stash:${reflog.oid}`,
      `stash:${wip.oid}`,
    ]);
    expect(ids("reflog", "stashes")).toEqual([
      "section:stashes",
      `stash:${reflog.oid}`,
    ]);
    expect(ids("", "all", [])).not.toContain("section:stashes");
    expect(ids("", "stashes", [], true)).toEqual(["section:stashes"]);
  });
});
