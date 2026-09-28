import { describe, expect, it } from "vite-plus/test";
import {
  historyCommit as commit,
  historyGraph,
} from "#tests-support/history.ts";

describe("history graph relation", () => {
  const graph = historyGraph([
    commit("merged", ["main", "topic"]),
    commit("topic", ["side"]),
    commit("main", ["trunk"]),
    commit("side", ["base"]),
    commit("trunk", ["base"]),
    commit("base", ["root"]),
    commit("root"),
  ]);

  it("counts the commits only each side has", () => {
    expect(graph.relation("topic", "main")).toEqual({ ahead: 2, behind: 2 });
    expect(graph.relation("merged", "main")).toEqual({ ahead: 3, behind: 0 });
    expect(graph.relation("base", "merged")).toEqual({ ahead: 0, behind: 5 });
    expect(graph.relation("main", "main")).toEqual({ ahead: 0, behind: 0 });
  });

  it("gives no answer when history is missing or unknown", () => {
    expect(graph.relation("unknown", "main")).toBeUndefined();
    const shallow = historyGraph([
      commit("left", ["cut"]),
      commit("right", ["base"]),
      commit("base"),
    ]);
    expect(shallow.relation("left", "right")).toBeUndefined();
  });
});
