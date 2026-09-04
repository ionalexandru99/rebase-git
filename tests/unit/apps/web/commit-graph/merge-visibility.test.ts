import type { RepositoryCommit } from "@rebase/contracts";
import { describe, expect, it } from "vitest";
import { visibleMergeTopology } from "#web/features/commit-graph/merge-visibility";

function commit(
  oid: string,
  parents: readonly string[] = [],
): RepositoryCommit {
  const identity = {
    name: "Alex",
    email: "alex@example.test",
    timestampSeconds: 0,
    timezoneOffsetMinutes: 0,
  };
  return { oid, parents, author: identity, committer: identity, subject: oid };
}

const commits = [
  commit("merge", ["main", "side"]),
  commit("main", ["base"]),
  commit("side", ["side-base", "nested"]),
  commit("nested", ["base"]),
  commit("side-base", ["base"]),
  commit("base"),
];
const visible = (roots: readonly string[], expanded: readonly string[]) =>
  visibleMergeTopology(commits, roots, new Set(expanded));

describe("merge visibility", () => {
  it("starts with scope first-parent lines and hides secondary connections", () => {
    const result = visible(["merge"], []);
    expect(result.commits.map(({ oid }) => oid)).toEqual([
      "merge",
      "main",
      "base",
    ]);
    expect(result.merges.get("merge")).toBe("collapsed");
    expect(result.topology[0]?.parents).toEqual(["main"]);
  });

  it("reveals direct parents but leaves nested topology collapsed", () => {
    const result = visible(["merge"], ["merge"]);
    expect(result.commits.map(({ oid }) => oid)).toEqual([
      "merge",
      "main",
      "side",
      "side-base",
      "base",
    ]);
    expect(result.merges.get("merge")).toBe("expanded");
    expect(result.merges.get("side")).toBe("collapsed");
    expect(visible(["merge"], ["merge", "side"]).commits).toEqual(commits);
  });

  it("preserves scope-owned lines and nested expansion state when a parent collapses", () => {
    expect(
      visible(["merge", "side"], []).commits.map(({ oid }) => oid),
    ).toContain("side");
    expect(visible(["merge", "side"], []).merges.has("merge")).toBe(false);
    expect(visible(["merge", "side"], ["merge"]).merges.has("merge")).toBe(
      false,
    );
    expect(
      visible(["merge"], ["side"]).commits.map(({ oid }) => oid),
    ).not.toContain("nested");
    expect(visible(["merge"], ["merge", "side"]).commits).toEqual(commits);
  });

  it("expands every octopus parent and retains lines owned by another expansion", () => {
    const graph = [
      commit("octopus", ["merge", "side", "other"]),
      ...commits,
      commit("other", ["base"]),
    ];
    const result = visibleMergeTopology(
      graph,
      ["octopus"],
      new Set(["octopus"]),
    );
    expect(result.commits.map(({ oid }) => oid)).toContain("other");
    expect(result.commits.map(({ oid }) => oid)).toContain("side");
    expect(result.merges.has("merge")).toBe(false);
  });

  it("keeps pending first-parent connections while an older page is loading", () => {
    const result = visibleMergeTopology(
      [commit("merge", ["main", "side"])],
      ["merge"],
      new Set(["merge"]),
    );
    expect([...result.missing].sort()).toEqual(["main", "side"]);
    expect(result.topology[0]?.parents).toEqual(["main", "side"]);
  });
});
