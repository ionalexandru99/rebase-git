import { describe, expect, it } from "vite-plus/test";
import {
  appendCommitLanes,
  createCommitLaneCheckpoint,
} from "#web/features/commit-graph/layout/commit-lanes";
import { graphRefLabels } from "#web/features/commit-graph/layout/graph-ref-labels";

describe("graph ref visibility", () => {
  it("shows only scoped branches ahead of local history and all refs within it", () => {
    const roots = [
      { name: "main", oid: "local", type: "branch" as const },
      { name: "origin/main", oid: "remote", type: "remote-branch" as const },
    ];
    const refs = [
      ...roots,
      { name: "parked-worktree", oid: "remote", type: "branch" as const },
      {
        name: "origin/unrelated",
        oid: "remote",
        type: "remote-branch" as const,
      },
      { name: "v1", oid: "remote", type: "tag" as const },
      { name: "older-worktree", oid: "local", type: "branch" as const },
    ];
    const { rows } = appendCommitLanes(
      createCommitLaneCheckpoint(),
      [
        { oid: "remote", parents: ["local"] },
        { oid: "local", parents: [] },
      ],
      new Map([
        ["remote", { color: 0, remote: true }],
        ["local", { color: 0, remote: false }],
      ]),
    );
    const labels = graphRefLabels(refs, rows, roots);
    expect(labels.get("remote")?.map((ref) => ref.name)).toEqual([
      "origin/main",
      "v1",
    ]);
    expect(labels.get("local")?.map((ref) => ref.name)).toEqual([
      "main",
      "older-worktree",
    ]);
  });
});
