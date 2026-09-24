import { describe, expect, it } from "vite-plus/test";
import {
  commitGraphQuery,
  historyQueriesEqual,
} from "#web/features/commit-graph/paging/commit-graph-query";

const main = { name: "main", oid: "a".repeat(40), type: "branch" } as const;

describe("commit graph query", () => {
  it("matches a located query whose fields arrive in another order", () => {
    const query = commitGraphQuery(
      [main],
      [],
      "topological",
      new Map([["b".repeat(40), ["c".repeat(40)]]]),
    );

    expect(
      historyQueriesEqual(query, {
        additionalParentEdges: [
          { parentOid: "c".repeat(40), childOid: "b".repeat(40) },
        ],
        ancestry: "first-parent",
        roots: [{ type: "branch", oid: main.oid, name: "main" }],
        order: "topological",
        offset: 0,
        limit: 100,
      }),
    ).toBe(true);
  });

  it("differs when a root moves to another commit", () => {
    const query = commitGraphQuery([main], [], "topological", new Map());
    const moved = commitGraphQuery(
      [main],
      [{ ...main, oid: "d".repeat(40) }],
      "topological",
      new Map(),
    );

    expect(historyQueriesEqual(query, moved)).toBe(false);
  });
});
