import type { RepositoryCommit } from "@rebase/contracts";
import {
  appendCommitLanes,
  type CommitLaneCheckpoint,
} from "#web/features/commit-graph/layout/commit-lanes";
import type {
  CommitGraphPage,
  CommitGraphPageReader,
} from "#web/features/commit-graph/paging/commit-graph-page-window.contract";
import type { RepositoryHistoryQuery } from "#web/features/repository-history/repository-history-reader.contract";

export async function prepareCommitGraphPage(
  reader: CommitGraphPageReader,
  query: RepositoryHistoryQuery,
  offset: number,
  incomingCheckpoint: CommitLaneCheckpoint,
  signal: AbortSignal,
): Promise<CommitGraphPage> {
  signal.throwIfAborted();
  const commits = await reader.read({ ...query, offset });
  signal.throwIfAborted();
  if (commits.length > query.limit)
    throw new Error("History page exceeds its requested size");
  const visibleParents = new Set([
    ...commits.map((commit) => commit.oid),
    ...query.roots.map((root) => root.oid),
  ]);
  const additionalEdges = new Set(
    (query.additionalParentEdges ?? []).map(
      (edge) => `${edge.childOid}\0${edge.parentOid}`,
    ),
  );
  const scopeOwned = new Set(query.roots.map((root) => root.oid));
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  for (const root of query.roots) {
    let current: string | undefined = root.oid;
    const visited = new Set<string>();
    while (current !== undefined && !visited.has(current)) {
      visited.add(current);
      scopeOwned.add(current);
      current = byOid.get(current)?.parents[0];
    }
  }
  if (query.ancestry === "first-parent") {
    const parents = [
      ...new Set(commits.flatMap((commit) => commit.parents.slice(1))),
    ];
    for (let start = 0; start < parents.length; start += 1_000) {
      const located = await reader.locateMany(
        query,
        parents.slice(start, start + 1_000),
      );
      signal.throwIfAborted();
      for (const { oid } of located) visibleParents.add(oid);
      const baseline =
        additionalEdges.size === 0
          ? located
          : await reader.locateMany(
              { ...query, additionalParentEdges: [] },
              parents.slice(start, start + 1_000),
            );
      signal.throwIfAborted();
      for (const { oid } of baseline) scopeOwned.add(oid);
    }
  }
  const topology = commits.map((commit) => ({
    oid: commit.oid,
    parents:
      query.ancestry === "first-parent"
        ? commit.parents.filter(
            (oid, index) =>
              index === 0 ||
              visibleParents.has(oid) ||
              additionalEdges.has(`${commit.oid}\0${oid}`),
          )
        : commit.parents,
  }));
  const plan = appendCommitLanes(incomingCheckpoint, topology);
  const merges = new Map<string, "collapsed" | "expanded">();
  for (const commit of commits) {
    if (
      commit.parents.length > 1 &&
      commit.parents.slice(1).some((oid) => !scopeOwned.has(oid))
    )
      merges.set(
        commit.oid,
        commit.parents
          .slice(1)
          .some((oid) => additionalEdges.has(`${commit.oid}\0${oid}`))
          ? "expanded"
          : "collapsed",
      );
  }
  const estimatedBytes =
    merges.size * 128 +
    commits.reduce((bytes, commit) => bytes + estimateCommit(commit), 0) +
    plan.rows.reduce(
      (bytes, row) =>
        bytes +
        160 +
        2 * row.oid.length +
        8 *
          (row.lanesBefore.length +
            row.lanesAfter.length +
            row.parentLaneIds.length),
      0,
    ) +
    topology.reduce(
      (bytes, commit) => bytes + 48 + commit.parents.length * 16,
      0,
    );
  return {
    offset,
    commits,
    merges,
    topology,
    rows: plan.rows,
    incomingCheckpoint,
    outgoingCheckpoint: plan.checkpoint,
    estimatedBytes,
  };
}

export function estimateCheckpoint(checkpoint: CommitLaneCheckpoint) {
  return (
    64 +
    checkpoint.lanes.reduce(
      (bytes, lane) => bytes + 64 + lane.expectedOid.length * 2,
      0,
    )
  );
}

function estimateCommit(commit: RepositoryCommit) {
  return (
    320 +
    2 *
      (commit.oid.length +
        commit.subject.length +
        commit.author.name.length +
        commit.author.email.length +
        commit.committer.name.length +
        commit.committer.email.length +
        commit.parents.reduce((size, parent) => size + parent.length, 0)) +
    commit.parents.length * 8
  );
}
