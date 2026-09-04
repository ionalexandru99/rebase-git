import {
  type CommitGraphSelection,
  type CommitGraphSelectionMode,
  emptyCommitGraphSelection,
} from "#web/features/commit-graph/commit-selection.contract";

export function selectGraphCommit(
  state: CommitGraphSelection,
  visibleOids: readonly string[],
  oid: string,
  mode: CommitGraphSelectionMode = "replace",
): CommitGraphSelection {
  const activeIndex = visibleOids.indexOf(oid);
  if (activeIndex < 0) return state;
  if (mode === "activate") return { ...state, activeOid: oid, activeIndex };
  if (mode === "replace")
    return { selectedOids: [oid], activeOid: oid, anchorOid: oid, activeIndex };
  if (mode === "range") {
    const anchorOid =
      [state.anchorOid, state.activeOid].find(
        (candidate): candidate is string =>
          candidate !== undefined && visibleOids.includes(candidate),
      ) ?? oid;
    const anchorIndex = Math.max(0, visibleOids.indexOf(anchorOid));
    return {
      selectedOids: visibleOids.slice(
        Math.min(anchorIndex, activeIndex),
        Math.max(anchorIndex, activeIndex) + 1,
      ),
      activeOid: oid,
      anchorOid,
      activeIndex,
    };
  }
  const selected = new Set(state.selectedOids);
  if (selected.has(oid)) selected.delete(oid);
  else selected.add(oid);
  return {
    selectedOids: visibleOids.filter((candidate) => selected.has(candidate)),
    activeOid: oid,
    anchorOid: oid,
    activeIndex,
  };
}

export function moveGraphSelection(
  state: CommitGraphSelection,
  visibleOids: readonly string[],
  offset: number,
  mode: CommitGraphSelectionMode = "replace",
): CommitGraphSelection {
  const current =
    state.activeOid === undefined
      ? state.activeIndex
      : visibleOids.indexOf(state.activeOid);
  const index = Math.max(
    0,
    Math.min(visibleOids.length - 1, Math.max(0, current) + offset),
  );
  const oid = visibleOids[index];
  return oid === undefined
    ? emptyCommitGraphSelection
    : selectGraphCommit(state, visibleOids, oid, mode);
}

export function clearGraphSelection(
  state: CommitGraphSelection,
): CommitGraphSelection {
  return { ...state, selectedOids: [] };
}

export function reconcileGraphSelection(
  state: CommitGraphSelection,
  visibleOids: readonly string[],
): CommitGraphSelection {
  if (visibleOids.length === 0) return emptyCommitGraphSelection;
  const survivingIndex =
    state.activeOid === undefined ? -1 : visibleOids.indexOf(state.activeOid);
  const activeIndex =
    survivingIndex >= 0
      ? survivingIndex
      : Math.min(state.activeIndex, visibleOids.length - 1);
  const activeOid = visibleOids[activeIndex];
  const selected = new Set(state.selectedOids);
  const anchorOid =
    state.anchorOid !== undefined && visibleOids.includes(state.anchorOid)
      ? state.anchorOid
      : activeOid;
  return {
    selectedOids: visibleOids.filter((oid) => selected.has(oid)),
    activeIndex,
    ...(activeOid === undefined ? {} : { activeOid }),
    ...(anchorOid === undefined ? {} : { anchorOid }),
  };
}
