import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import type { CommitLaneRow } from "#web/features/commit-graph/layout/commit-lanes.contract";

export function graphRefLabels(
  refs: readonly RepositoryHistoryRefTarget[],
  rows: readonly CommitLaneRow[],
  roots: readonly RepositoryHistoryRefTarget[],
) {
  const remote = new Set(
    rows.filter((row) => row.nodeRemote).map((row) => row.oid),
  );
  const selected = new Set(roots.map((ref) => `${ref.type}\0${ref.name}`));
  const labels = new Map<string, RepositoryHistoryRefTarget[]>();
  for (const ref of refs) {
    if (ref.type === "head") continue;
    if (
      ref.type !== "tag" &&
      remote.has(ref.oid) &&
      !selected.has(`${ref.type}\0${ref.name}`)
    )
      continue;
    const current = labels.get(ref.oid);
    if (current === undefined) labels.set(ref.oid, [ref]);
    else current.push(ref);
  }
  return labels;
}
