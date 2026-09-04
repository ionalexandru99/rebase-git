import { describe, expect, it } from "vitest";
import { HistoryOrderIndex } from "#web/features/repository-history/history-order";

const node = (oid: string, parents: readonly string[] = []) => ({
  oid,
  parents,
  timestamp: 0,
});

describe("history ancestry navigation", () => {
  it("returns only required secondary edges, ordered from roots toward the target", () => {
    const index = new HistoryOrderIndex([
      node("tip", ["outer"]),
      node("outer", ["main", "inner"]),
      node("inner", ["main", "side"]),
      node("side", ["target"]),
      node("target"),
      node("main"),
    ]);
    expect(index.ancestryRoute(["tip"], "target")).toEqual({
      edges: [
        { childOid: "outer", parentOid: "inner" },
        { childOid: "inner", parentOid: "side" },
      ],
    });
    expect(index.ancestryRoute(["tip"], "main")).toEqual({ edges: [] });
    expect(index.ancestryRoute(["target"], "target")).toEqual({ edges: [] });
    expect(index.ancestryRoute(["main"], "target")).toBeUndefined();
    expect(index.ancestryRoute(["missing"], "target")).toBeUndefined();
    expect(index.ancestryRoute(["tip"], "missing")).toBeUndefined();
  });

  it("prefers fewer secondary crossings even when a longer first-parent route exists", () => {
    const index = new HistoryOrderIndex([
      node("tip", ["a", "target"]),
      node("a", ["b"]),
      node("b", ["target"]),
      node("target"),
    ]);
    expect(index.ancestryRoute(["tip"], "target")).toEqual({ edges: [] });
    expect(index.ancestryRoute(["tip", "target"], "target")).toEqual({
      edges: [],
    });
  });

  it("keeps missing first-parent boundaries distinct from secondary ancestry", () => {
    const index = new HistoryOrderIndex([
      node("merge", ["missing", "side"]),
      node("side"),
    ]);
    expect(index.ancestryRoute(["merge"], "side")).toEqual({
      edges: [{ childOid: "merge", parentOid: "side" }],
    });
  });

  it("handles octopus and criss-cross paths deterministically", () => {
    const index = new HistoryOrderIndex([
      node("tip", ["main", "left", "right"]),
      node("main"),
      node("left", ["a", "b"]),
      node("right", ["b", "a"]),
      node("a", ["target"]),
      node("b", ["target"]),
      node("target"),
    ]);
    const route = index.ancestryRoute(["tip"], "target");
    expect(route?.edges).toHaveLength(1);
    expect(index.ancestryRoute(["tip"], "target")).toEqual(route);
    expect(
      index.order(["tip"], "topological", [], "first-parent", route?.edges),
    ).toContain("target");
  });

  it("bounds returned edges and resumes a deeply nested route without recursion", () => {
    const nodes = Array.from({ length: 1_005 }, (_, index) =>
      node(`merge-${index}`, [
        "main",
        index === 1_004 ? "target" : `merge-${index + 1}`,
      ]),
    );
    const index = new HistoryOrderIndex([
      ...nodes,
      node("main"),
      node("target"),
    ]);
    const first = index.ancestryRoute(["merge-0"], "target");
    expect(first?.edges).toHaveLength(1_000);
    expect(first?.continuationOid).toBe("merge-1000");
    const rest = index.ancestryRoute([first?.continuationOid ?? ""], "target");
    expect(rest?.edges).toHaveLength(5);
    expect(rest?.continuationOid).toBeUndefined();
    expect(
      index.order(["merge-0"], "topological", [], "first-parent", [
        ...(first?.edges ?? []),
        ...(rest?.edges ?? []),
      ]),
    ).toContain("target");
  });
});
