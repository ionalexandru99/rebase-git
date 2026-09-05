import type { RepositoryCommit } from "@rebase/contracts";

export function visibleMergeTopology(
  commits: readonly RepositoryCommit[],
  roots: readonly string[],
  expanded: ReadonlySet<string>,
) {
  const byOid = new Map(commits.map((commit) => [commit.oid, commit]));
  const { visible, missing } = traverseVisibleParents(byOid, roots, expanded);
  const scopeOwned = traverseVisibleParents(byOid, roots, new Set()).visible;
  const rows = commits.filter((commit) => visible.has(commit.oid));
  const merges = new Map<string, "collapsed" | "expanded">();
  for (const commit of rows) {
    if (
      commit.parents.length < 2 ||
      commit.parents.slice(1).every((oid) => scopeOwned.has(oid))
    )
      continue;
    if (expanded.has(commit.oid)) merges.set(commit.oid, "expanded");
    else if (
      commit.parents
        .slice(1)
        .some((oid) => !visible.has(oid) && !missing.has(oid))
    )
      merges.set(commit.oid, "collapsed");
  }
  const topology = rows.map((commit) => ({
    oid: commit.oid,
    parents: commit.parents.filter(
      (oid, index) => index === 0 || visible.has(oid) || missing.has(oid),
    ),
  }));
  return { commits: rows, merges, missing, topology };
}

function traverseVisibleParents(
  byOid: ReadonlyMap<string, RepositoryCommit>,
  roots: readonly string[],
  expanded: ReadonlySet<string>,
) {
  const visible = new Set<string>();
  const pending = [...roots];
  const missing = new Set<string>();
  while (pending.length > 0) {
    const oid = pending.pop();
    if (oid === undefined || visible.has(oid)) continue;
    const commit = byOid.get(oid);
    if (commit === undefined) {
      missing.add(oid);
      continue;
    }
    visible.add(oid);
    const firstParent = commit.parents[0];
    if (firstParent !== undefined) pending.push(firstParent);
    if (expanded.has(oid)) pending.push(...commit.parents.slice(1));
  }
  return { visible, missing };
}
