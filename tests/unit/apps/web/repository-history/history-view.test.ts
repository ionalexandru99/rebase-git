import { describe, expect, it } from "vite-plus/test";
import {
  historyCommit as commit,
  historyGraph,
  historyOid,
  historyScope,
  linearHistory,
} from "#tests-support/history.ts";
import { HistoryGraph } from "#web/features/repository-history/history-graph.ts";
import {
  findInHistory,
  type HistoryScopeQuery,
  HistoryView,
} from "#web/features/repository-history/history-view.ts";

const mergeHistory = [
  commit("merge", ["main", "side"], 1),
  commit("main", ["base"], 2),
  commit("side", ["base"], 8),
  commit("base", [], 10),
];

function ordered(graph: HistoryGraph, scope: HistoryScopeQuery) {
  const view = new HistoryView(graph, scope, []);
  return view.oids(0, view.total);
}

describe("history view", () => {
  it("follows first parents and adds only expanded lines reachable from the scope", () => {
    const graph = historyGraph([...mergeHistory, commit("unrelated", [], 20)]);
    expect(ordered(graph, historyScope(["merge"]))).toEqual([
      "merge",
      "main",
      "base",
    ]);
    expect(
      ordered(
        graph,
        historyScope(["merge"], {
          expanded: [
            { childOid: "merge", parentOid: "side" },
            { childOid: "merge", parentOid: "unrelated" },
          ],
        }),
      ),
    ).toEqual(["merge", "main", "side", "base"]);
  });

  it("keeps a missing first parent missing and a nested line hidden below a collapsed merge", () => {
    expect(
      ordered(
        historyGraph([commit("merge", ["missing", "side"]), commit("side")]),
        historyScope(["merge"]),
      ),
    ).toEqual(["merge"]);
    const graph = historyGraph([
      commit("outer", ["main", "inner"], 4),
      commit("inner", ["main", "side"], 3),
      commit("side", ["base"], 2),
      commit("main", ["base"], 1),
      commit("base", [], 0),
    ]);
    const nested = { childOid: "inner", parentOid: "side" };
    expect(
      ordered(graph, historyScope(["outer"], { expanded: [nested] })),
    ).toEqual(["outer", "main", "base"]);
    expect(
      ordered(
        graph,
        historyScope(["outer"], {
          expanded: [nested, { childOid: "outer", parentOid: "inner" }],
        }),
      ),
    ).toEqual(["outer", "inner", "side", "main", "base"]);
  });

  it.each(["topological", "chronological"] as const)(
    "keeps octopus and criss-cross ancestry valid across 256 tips in %s order",
    (order) => {
      const tips = Array.from({ length: 256 }, (_, index) =>
        commit(
          `tip-${index}`,
          [index % 2 === 0 ? "left" : "right"],
          index % 17,
        ),
      );
      const commits = [
        commit(
          "octopus",
          tips.map(({ oid }) => oid),
          0,
        ),
        ...tips,
        commit("left", ["a", "b"], 99),
        commit("right", ["b", "a"], 98),
        commit("a", ["base"], 101),
        commit("b", ["base"], 101),
        commit("base", [], 1_000),
      ];
      const expanded = tips.map(({ oid }) => ({
        childOid: "octopus",
        parentOid: oid,
      }));
      const result = ordered(
        historyGraph(commits),
        historyScope(["octopus"], {
          order,
          expanded: [
            ...expanded,
            { childOid: "left", parentOid: "b" },
            { childOid: "right", parentOid: "a" },
          ],
        }),
      );
      expect(new Set(result).size).toBe(commits.length);
      const positions = new Map(result.map((oid, index) => [oid, index]));
      for (const node of commits)
        for (const parent of node.parents)
          expect(positions.get(node.oid)).toBeLessThan(
            positions.get(parent) ?? -1,
          );
    },
  );

  it("orders by stored topology or by committer date without breaking ancestry", () => {
    const graph = historyGraph(mergeHistory);
    const scope = historyScope(["merge"], {
      expanded: [{ childOid: "merge", parentOid: "side" }],
    });
    expect(ordered(graph, scope)).toEqual(["merge", "main", "side", "base"]);
    expect(ordered(graph, { ...scope, order: "chronological" })).toEqual([
      "merge",
      "side",
      "main",
      "base",
    ]);
  });

  it("places commits from a later synchronization before the history they extend", () => {
    const graph = historyGraph(linearHistory(3));
    graph.add(commit("newer", [historyOid(0)]), -(2 ** 32));
    graph.add(commit("newest", ["newer"]), -(2 ** 32) + 1);
    expect(ordered(graph, historyScope(["newest"]))).toEqual([
      "newest",
      "newer",
      historyOid(0),
      historyOid(1),
      historyOid(2),
    ]);
  });

  it("draws lanes that pass through from above after jumping to a far row", () => {
    const main = linearHistory(600);
    const commits = [commit("feature", [historyOid(590)], 1), ...main];
    const scope = historyScope([
      { name: "main", oid: historyOid(0), type: "branch" },
      { name: "feature", oid: "feature", type: "branch" },
    ]);
    const fromTop = new HistoryView(historyGraph(commits), scope, []).rows(
      0,
      600,
    );
    const jumped = new HistoryView(historyGraph(commits), scope, []).rows(
      500,
      520,
    );
    expect(jumped.map(({ oid }) => oid)).toEqual(
      fromTop.slice(500, 520).map(({ oid }) => oid),
    );
    expect(jumped.map(({ lane }) => lane)).toEqual(
      fromTop.slice(500, 520).map(({ lane }) => lane),
    );
    expect(jumped.every(({ lane }) => lane.lanesBefore.length === 2)).toBe(
      true,
    );
  });

  it("continues lanes exactly when older commits arrive after a deep read", () => {
    const main = linearHistory(600).map((current, index) =>
      index === 5 ? { ...current, parents: [historyOid(6), "side"] } : current,
    );
    const graph = historyGraph([commit("topic", ["side"]), ...main]);
    const scope = historyScope([historyOid(0), "topic"]);
    const continued = (previous: HistoryView) => {
      const next = new HistoryView(graph, scope, [], previous);
      const fresh = new HistoryView(graph, scope, []);
      expect(next.rows(520, next.total)).toEqual(fresh.rows(520, fresh.total));
      return next;
    };
    const first = new HistoryView(graph, scope, []);
    first.rows(0, first.total);

    graph.add(commit("root", []), 1_000);
    const second = continued(first);
    graph.add(commit("side", ["root"]), 1_001);
    continued(second);
  });

  it("marks merges whose side line is hidden and follows an expanded one", () => {
    const graph = historyGraph(mergeHistory);
    const collapsed = new HistoryView(graph, historyScope(["merge"]), []);
    expect(collapsed.rows(0, 1)[0]?.merge).toBe("collapsed");
    const expanded = new HistoryView(
      graph,
      historyScope(["merge"], {
        expanded: [{ childOid: "merge", parentOid: "side" }],
      }),
      [],
    );
    expect(expanded.rows(0, 1)[0]?.merge).toBe("expanded");
    const scopeOwned = new HistoryView(
      graph,
      historyScope(["merge", "side"]),
      [],
    );
    expect(scopeOwned.rows(0, 1)[0]?.merge).toBeUndefined();
  });

  it("finds a commit behind a collapsed merge, under a ref outside the scope or only in the reflog", () => {
    const graph = historyGraph([
      ...mergeHistory,
      commit("topic", ["base"], 5),
      commit("dropped", ["base"], 6),
    ]);
    const refs = [{ name: "topic", oid: "topic", type: "branch" as const }];
    const view = (scope: HistoryScopeQuery) =>
      new HistoryView(graph, scope, refs);
    expect(
      findInHistory(graph, refs, historyScope(["merge"]), "side", view),
    ).toEqual({
      index: 2,
      expanded: [{ childOid: "merge", parentOid: "side" }],
    });
    expect(
      findInHistory(graph, refs, historyScope(["main"]), "topic", view),
    ).toEqual({ index: 1, expanded: [], root: refs[0] });
    expect(
      findInHistory(graph, refs, historyScope(["merge"]), "dropped", view),
    ).toMatchObject({
      expanded: [],
      root: { name: "dropped", oid: "dropped", type: "commit" },
    });
    expect(
      findInHistory(graph, refs, historyScope(["merge"]), "missing", view),
    ).toBeUndefined();
  });

  it("keeps parents that arrive after their children when restored from its stored topology", () => {
    const graph = historyGraph([commit("child", ["parent", "later"])]);
    graph.add(commit("parent"), 1);
    const restored = HistoryGraph.fromTopology(graph.topology());
    restored.add(commit("later"), 2);
    expect(
      ordered(
        restored,
        historyScope(["child"], {
          expanded: [{ childOid: "child", parentOid: "later" }],
        }),
      ),
    ).toEqual(["child", "parent", "later"]);
  });
});
