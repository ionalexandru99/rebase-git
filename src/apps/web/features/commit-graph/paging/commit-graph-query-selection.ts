import type {
  CommitGraphSelection,
  CommitGraphSelectionMode,
} from "#web/features/commit-graph/commit-selection.contract";
import type {
  RepositoryHistoryPosition,
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";

export async function locateGraphSelection(
  reader: Pick<RepositoryHistoryReader, "locateMany">,
  query: RepositoryHistoryQuery,
  oids: readonly string[],
  cancelled: () => boolean,
): Promise<readonly RepositoryHistoryPosition[]> {
  const positions: RepositoryHistoryPosition[] = [];
  const unique = [...new Set(oids)];
  for (let offset = 0; offset < unique.length; offset += 1_000) {
    if (cancelled()) return [];
    positions.push(
      ...(await reader.locateMany(query, unique.slice(offset, offset + 1_000))),
    );
  }
  return positions.sort((left, right) => left.index - right.index);
}

export async function selectGraphQueryCommit(
  reader: Pick<RepositoryHistoryReader, "locateMany" | "read">,
  query: RepositoryHistoryQuery,
  state: CommitGraphSelection,
  oid: string,
  mode: CommitGraphSelectionMode,
  startOffset: number,
  cancelled: () => boolean,
): Promise<CommitGraphSelection | undefined> {
  const anchor = state.anchorOid ?? state.activeOid ?? oid;
  const positions = await locateGraphSelection(
    reader,
    query,
    mode === "range" ? [anchor, oid] : [...state.selectedOids, oid],
    cancelled,
  );
  const target = positions.find((position) => position.oid === oid);
  if (target === undefined || cancelled()) return;
  if (mode !== "range") {
    const selected = new Set(state.selectedOids);
    if (selected.has(oid)) selected.delete(oid);
    else selected.add(oid);
    return {
      selectedOids: positions
        .filter((position) => selected.has(position.oid))
        .map((position) => position.oid),
      activeOid: oid,
      anchorOid: oid,
      activeIndex: target.index - startOffset,
    };
  }
  const anchorPosition =
    positions.find((position) => position.oid === anchor) ?? target;
  const end = Math.max(anchorPosition.index, target.index);
  const selectedOids: string[] = [];
  for (
    let offset = Math.min(anchorPosition.index, target.index);
    offset <= end;
    offset += 1_000
  ) {
    if (cancelled()) return;
    const commits = await reader.read({
      ...query,
      offset,
      limit: Math.min(1_000, end - offset + 1),
    });
    selectedOids.push(...commits.map((commit) => commit.oid));
    if (commits.length < Math.min(1_000, end - offset + 1)) break;
  }
  if (cancelled()) return;
  return {
    selectedOids,
    activeOid: oid,
    anchorOid: anchorPosition.oid,
    activeIndex: target.index - startOffset,
  };
}

export async function reconcileGraphQuerySelection(
  reader: Pick<RepositoryHistoryReader, "locateMany" | "read">,
  query: RepositoryHistoryQuery,
  state: CommitGraphSelection,
  previousStartOffset: number,
  startOffset: number,
  windowOids: readonly string[],
  cancelled: () => boolean,
): Promise<CommitGraphSelection | undefined> {
  if (state.activeOid === undefined && state.selectedOids.length === 0) {
    const activeIndex = Math.max(
      0,
      Math.min(state.activeIndex, windowOids.length - 1),
    );
    const activeOid = windowOids[activeIndex];
    return {
      selectedOids: [],
      activeIndex,
      ...(activeOid === undefined ? {} : { activeOid, anchorOid: activeOid }),
    };
  }
  const positions = await locateGraphSelection(
    reader,
    query,
    [
      ...state.selectedOids,
      ...(state.activeOid === undefined ? [] : [state.activeOid]),
      ...(state.anchorOid === undefined ? [] : [state.anchorOid]),
    ],
    cancelled,
  );
  if (cancelled()) return;
  let active = positions.find((position) => position.oid === state.activeOid);
  if (active === undefined) {
    const index = Math.max(0, previousStartOffset + state.activeIndex);
    active = await findGraphSelectionReplacement(
      reader,
      query,
      index,
      cancelled,
    );
  }
  if (cancelled()) return;
  const selected = new Set(state.selectedOids);
  const anchor =
    positions.find((position) => position.oid === state.anchorOid) ?? active;
  return {
    selectedOids: positions
      .filter((position) => selected.has(position.oid))
      .map((position) => position.oid),
    activeIndex: active === undefined ? 0 : active.index - startOffset,
    ...(active === undefined ? {} : { activeOid: active.oid }),
    ...(anchor === undefined ? {} : { anchorOid: anchor.oid }),
  };
}

async function findGraphSelectionReplacement(
  reader: Pick<RepositoryHistoryReader, "read">,
  query: RepositoryHistoryQuery,
  index: number,
  cancelled: () => boolean,
): Promise<RepositoryHistoryPosition | undefined> {
  const replacement = (
    await reader.read({ ...query, offset: index, limit: 1 })
  )[0];
  if (replacement !== undefined) return { oid: replacement.oid, index };
  let lower = 0;
  let upper = index - 1;
  let previous: RepositoryHistoryPosition | undefined;
  while (lower <= upper) {
    if (cancelled()) return;
    const middle = lower + Math.floor((upper - lower) / 2);
    const commit = (
      await reader.read({ ...query, offset: middle, limit: 1 })
    )[0];
    if (commit === undefined) upper = middle - 1;
    else {
      previous = { oid: commit.oid, index: middle };
      lower = middle + 1;
    }
  }
  return previous;
}
