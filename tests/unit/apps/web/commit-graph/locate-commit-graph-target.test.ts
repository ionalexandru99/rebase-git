import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import { describe, expect, it, vi } from "vitest";
import type { CommitGraphPageReader } from "#web/features/commit-graph/paging/commit-graph-page-window.contract";
import { locateCommitGraphTarget } from "#web/features/commit-graph/paging/locate-commit-graph-target";
import { HistoryOrderIndex } from "#web/features/repository-history/query/history-order";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

describe("search navigation outside the graph scope", () => {
  it("finds a containing branch in bounded batches and opens its folded ancestry", async () => {
    const refs: RepositoryHistoryRefTarget[] = Array.from(
      { length: 260 },
      (_, index) => ({
        type: "branch",
        name: `branch-${index.toString().padStart(3, "0")}`,
        oid: `tip-${index}`,
      }),
    );
    const main = { type: "branch" as const, name: "main", oid: "main" };
    const index = new HistoryOrderIndex([
      { oid: "main", parents: [], timestamp: 0 },
      ...refs.map((ref, position) => ({
        oid: ref.oid,
        parents: position === 259 ? ["main", "target"] : ["main"],
        timestamp: 1,
      })),
      { oid: "target", parents: [], timestamp: 0 },
    ]);
    const reader = {
      getRefTargets: async () => [main, ...refs],
      ancestryRoute: vi.fn(async (roots, oid) => {
        expect(roots.length).toBeLessThanOrEqual(256);
        return index.ancestryRoute(roots, oid);
      }),
      locate: async (query, oid) => {
        const offset = index
          .order(
            query.roots.map((ref) => ref.oid),
            query.order,
            [],
            query.ancestry,
            query.additionalParentEdges,
          )
          .indexOf(oid);
        return offset < 0 ? undefined : offset;
      },
      read: async () => [],
      locateMany: async () => [],
    } satisfies CommitGraphPageReader;
    const query: RepositoryHistoryQuery = {
      roots: [main],
      order: "topological",
      ancestry: "first-parent",
      limit: 20,
    };
    const result = await locateCommitGraphTarget(
      reader,
      query,
      "target",
      new AbortController().signal,
    );
    expect(result?.query.roots).toEqual([main, refs[259]]);
    expect(result?.query.additionalParentEdges).toEqual([
      { childOid: "tip-259", parentOid: "target" },
    ]);
    expect(result?.offset).toBeGreaterThanOrEqual(0);
    expect(query.roots).toEqual([main]);
  });

  it("does not reveal a branch after navigation is cancelled", async () => {
    const controller = new AbortController();
    const reader: CommitGraphPageReader = {
      locate: async () => undefined,
      getRefTargets: async () => [
        { name: "feature", type: "branch", oid: "tip" },
      ],
      ancestryRoute: async () => {
        controller.abort();
        return { rootOid: "tip", edges: [] };
      },
      read: async () => [],
      locateMany: async () => [],
    };
    await expect(
      locateCommitGraphTarget(
        reader,
        { roots: [], order: "topological", ancestry: "all", limit: 20 },
        "target",
        controller.signal,
      ),
    ).rejects.toThrow();
  });
});
