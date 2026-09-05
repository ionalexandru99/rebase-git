import { describe, expect, it } from "vitest";
import { HistoryOrderIndex } from "#web/features/repository-history/query/history-order";
import type { HistoryOrderNode } from "#web/features/repository-history/query/history-order.contract";
import { historyOrderScopeKey } from "#web/features/repository-history/query/repository-history-query";

function orderHistory(
  nodes: readonly HistoryOrderNode[],
  roots: readonly string[],
  order: "topological" | "chronological",
  previous?: readonly string[],
) {
  return new HistoryOrderIndex(nodes).order(roots, order, previous);
}

const nodes = [
  { oid: "merge", parents: ["main", "side"], timestamp: 1 },
  { oid: "main", parents: ["base"], timestamp: 2 },
  { oid: "side", parents: ["base"], timestamp: 8 },
  { oid: "base", parents: [], timestamp: 10 },
];

describe("local history ordering", () => {
  it("isolates detached HEAD scopes while preserving a moving branch scope", () => {
    const key = (type: "branch" | "head", oid: string) =>
      historyOrderScopeKey({
        order: "topological",
        roots: [{ name: type === "head" ? "HEAD" : "main", type, oid }],
      });
    expect(key("head", "a")).not.toBe(key("head", "b"));
    expect(key("branch", "a")).toBe(key("branch", "b"));
  });
  it("queries first-parent ancestry and only adds lines reachable from the scope", () => {
    const index = new HistoryOrderIndex([
      ...nodes,
      { oid: "unrelated", parents: [], timestamp: 20 },
    ]);
    expect(index.order(["merge"], "topological", [], "first-parent")).toEqual([
      "merge",
      "main",
      "base",
    ]);
    expect(
      index.order(["merge"], "topological", [], "first-parent", [
        { childOid: "merge", parentOid: "side" },
        { childOid: "merge", parentOid: "unrelated" },
      ]),
    ).toEqual(["merge", "main", "side", "base"]);
    expect(
      index.order(["main"], "topological", [], "first-parent", [
        { childOid: "merge", parentOid: "side" },
      ]),
    ).toEqual(["main", "base"]);
  });

  it("does not substitute a secondary parent for a missing first parent", () => {
    const index = new HistoryOrderIndex([
      { oid: "merge", parents: ["missing", "side"], timestamp: 1 },
      { oid: "side", parents: [], timestamp: 2 },
    ]);
    expect(index.order(["merge"], "topological", [], "first-parent")).toEqual([
      "merge",
    ]);
  });
  it("does not reveal retained nested parent edges below a collapsed ancestor", () => {
    const index = new HistoryOrderIndex([
      { oid: "outer", parents: ["main", "inner"], timestamp: 4 },
      { oid: "inner", parents: ["main", "side"], timestamp: 3 },
      { oid: "side", parents: ["base"], timestamp: 2 },
      { oid: "main", parents: ["base"], timestamp: 1 },
      { oid: "base", parents: [], timestamp: 0 },
    ]);
    const nested = { childOid: "inner", parentOid: "side" };
    expect(
      index.order(["outer"], "topological", [], "first-parent", [nested]),
    ).toEqual(["outer", "main", "base"]);
    expect(
      index.order(["outer"], "topological", [], "first-parent", [
        nested,
        { childOid: "outer", parentOid: "inner" },
      ]),
    ).toEqual(["outer", "inner", "side", "main", "base"]);
  });
  it.each(["topological", "chronological"] as const)(
    "keeps octopus and criss-cross ancestry valid across 256 tips in %s order",
    (order) => {
      const tips = Array.from({ length: 256 }, (_, index) => ({
        oid: `tip-${index}`,
        parents: [index % 2 === 0 ? "left" : "right"],
        timestamp: index % 17,
      }));
      const graph = [
        { oid: "octopus", parents: tips.map(({ oid }) => oid), timestamp: 0 },
        ...tips,
        { oid: "left", parents: ["a", "b"], timestamp: 99 },
        { oid: "right", parents: ["b", "a"], timestamp: 98 },
        { oid: "a", parents: ["base"], timestamp: 101 },
        { oid: "b", parents: ["base"], timestamp: 101 },
        { oid: "base", parents: [], timestamp: 1_000 },
      ];
      const result = new HistoryOrderIndex(graph).order(["octopus"], order);
      expect(new Set(result).size).toBe(graph.length);
      const positions = new Map(result.map((oid, index) => [oid, index]));
      for (const node of graph)
        for (const parent of node.parents) {
          expect(positions.get(node.oid)).toBeLessThan(
            positions.get(parent) ?? -1,
          );
        }
    },
  );
  it("keeps branch topology in stored order and dates ancestry-safe", () => {
    expect(orderHistory(nodes, ["merge"], "topological")).toEqual([
      "merge",
      "main",
      "side",
      "base",
    ]);
    expect(orderHistory(nodes, ["merge"], "chronological")).toEqual([
      "merge",
      "side",
      "main",
      "base",
    ]);
  });

  it("handles multiple roots, shallow parents, ties, and shared ancestry once", () => {
    expect(
      orderHistory(
        [...nodes, { oid: "other", parents: ["missing"], timestamp: 8 }],
        ["side", "main", "other"],
        "chronological",
      ),
    ).toEqual(["side", "other", "main", "base"]);
  });

  it("preserves the relative order of existing rows when new tips arrive", () => {
    const previous = orderHistory(nodes, ["merge"], "chronological");
    const result = orderHistory(
      [{ oid: "new", parents: ["main"], timestamp: 20 }, ...nodes],
      ["merge", "new"],
      "chronological",
      previous,
    );
    expect(result.filter((oid) => oid !== "new")).toEqual(previous);
    expect(result.indexOf("new")).toBeLessThan(result.indexOf("main"));
  });

  it("does not let a newly revealed child reorder older rows", () => {
    const graph = [
      { oid: "new", parents: ["early"], timestamp: 0 },
      { oid: "early", parents: [], timestamp: 1 },
      { oid: "late", parents: [], timestamp: 10 },
    ];
    expect(
      orderHistory(graph, ["new", "late"], "chronological", ["early", "late"]),
    ).toEqual(["new", "early", "late"]);
  });

  it("places newer live commits before older independent rows while preserving existing row order", () => {
    const graph = [
      { oid: "new-feature", parents: ["feature"], timestamp: 100 },
      { oid: "main", parents: [], timestamp: 1 },
      { oid: "feature", parents: [], timestamp: 0 },
    ];
    expect(
      orderHistory(graph, ["main", "new-feature"], "chronological", [
        "main",
        "feature",
      ]),
    ).toEqual(["new-feature", "main", "feature"]);
  });
});
