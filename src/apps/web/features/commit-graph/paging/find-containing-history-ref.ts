import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import type { CommitGraphPageReader } from "#web/features/commit-graph/paging/commit-graph-page-window.contract";

export async function findContainingHistoryRef(
  reader: CommitGraphPageReader,
  oid: string,
  signal: AbortSignal,
): Promise<RepositoryHistoryRefTarget | undefined> {
  const refs = (await reader.getRefTargets()).filter(
    (ref) => ref.type !== "head",
  );
  signal.throwIfAborted();
  for (const type of ["branch", "remote-branch", "tag"] as const) {
    const candidates = refs
      .filter((ref) => ref.type === type)
      .sort((left, right) => left.name.localeCompare(right.name));
    const exact = candidates.find((ref) => ref.oid === oid);
    if (exact !== undefined) return exact;
    for (let offset = 0; offset < candidates.length; offset += 256) {
      const batch = candidates.slice(offset, offset + 256);
      const route = await reader.ancestryRoute(
        batch.map((ref) => ref.oid),
        oid,
      );
      signal.throwIfAborted();
      if (route !== undefined)
        return batch.find((ref) => ref.oid === route.rootOid);
    }
  }
  return undefined;
}
