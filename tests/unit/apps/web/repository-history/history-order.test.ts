import { describe, expect, it } from "vitest";
import { HistoryOrderIndex } from "#web/features/repository-history/history-order";
import type { HistoryOrderNode } from "#web/features/repository-history/history-order.contract";

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
});
