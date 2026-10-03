import { describe, expect, it } from "vite-plus/test";
import {
  branchScenarioRefs,
  mainPath,
  repositoryStash,
  topicPath,
} from "#tests-support/fixtures.ts";
import {
  branchesSidebarItems,
  buildBranchesSidebarRows,
  defaultExpandedSections,
  dockItems,
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

  it("keeps Local on top and docks the other sections with their drafts", () => {
    const rows = buildBranchesSidebarRows(
      branchScenarioRefs(),
      mainPath,
      defaultExpandedSections,
      "",
    );
    const ids = (items: ReturnType<typeof dockItems>["top"]) =>
      items.map((item) => item.id);

    const branchDraft = dockItems(branchesSidebarItems(rows, "branches"));
    expect(ids(branchDraft.top)).toEqual([
      "section:branches",
      "ref-draft",
      "ref:branches:main",
      "ref:branches:topic",
      "ref:branches:feature",
    ]);
    expect(ids(branchDraft.docked)).toEqual([
      "section:remote:origin",
      "section:remote:upstream",
      "section:tags",
    ]);

    const tagDraft = dockItems(branchesSidebarItems(rows, "tags"));
    expect(ids(tagDraft.top)).toHaveLength(4);
    expect(ids(tagDraft.docked).slice(-2)).toEqual([
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
    expect(dockItems(branchesSidebarItems(remotes, undefined)).top).toEqual([]);
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

  it("lists stashes after tags, filters them by name, and keeps the section while one is named", () => {
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

    expect(ids("", "all").slice(-3)).toEqual([
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
