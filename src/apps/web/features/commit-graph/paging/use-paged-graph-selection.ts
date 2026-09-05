import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clearGraphSelection,
  reconcileGraphSelection,
  selectGraphCommit,
} from "#web/features/commit-graph/commit-selection";
import {
  type CommitGraphSelectionMode,
  emptyCommitGraphSelection,
} from "#web/features/commit-graph/commit-selection.contract";
import {
  reconcileGraphQuerySelection,
  selectGraphQueryCommit,
} from "#web/features/commit-graph/paging/commit-graph-query-selection";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";

export function usePagedGraphSelection({
  reader,
  query,
  oids,
  loading,
  startOffset,
  viewEpoch,
}: {
  readonly reader:
    | Pick<RepositoryHistoryReader, "read" | "locateMany">
    | undefined;
  readonly query: RepositoryHistoryQuery | undefined;
  readonly oids: readonly string[];
  readonly loading: boolean;
  readonly startOffset: number;
  readonly viewEpoch: number;
}) {
  const [selection, setSelection] = useState(emptyCommitGraphSelection);
  const selectionRef = useRef(selection);
  const intent = useRef(0);
  const needsReconciliation = useRef(false);
  const currentStartOffset = useRef(startOffset);
  currentStartOffset.current = startOffset;
  const updateSelection = useCallback((next: typeof selection) => {
    selectionRef.current = next;
    setSelection(next);
  }, []);
  const previousWindow = useRef({ startOffset, viewEpoch });
  useEffect(() => {
    intent.current += 1;
    if (reader !== undefined || selectionRef.current.activeOid !== undefined)
      updateSelection(emptyCommitGraphSelection);
    return () => {
      intent.current += 1;
    };
  }, [reader, updateSelection]);
  useEffect(() => {
    const previous = previousWindow.current;
    if (previous.viewEpoch !== viewEpoch) needsReconciliation.current = true;
    if (previous.viewEpoch !== viewEpoch && loading) {
      intent.current += 1;
      return;
    }
    previousWindow.current = { startOffset, viewEpoch };
    const current = selectionRef.current;
    if (previous.viewEpoch !== viewEpoch) {
      const request = ++intent.current;
      if (reader !== undefined && query !== undefined) {
        void reconcileGraphQuerySelection(
          reader,
          query,
          current,
          previous.startOffset,
          startOffset,
          oids,
          () => intent.current !== request,
        )
          .then((next) => {
            if (next !== undefined && intent.current === request) {
              needsReconciliation.current = false;
              updateSelection({
                ...next,
                activeIndex:
                  next.activeIndex + startOffset - currentStartOffset.current,
              });
            }
          })
          .catch(() => {});
      } else updateSelection(reconcileGraphSelection(current, oids));
      return;
    }
    const activeIndex =
      current.activeOid === undefined ? -1 : oids.indexOf(current.activeOid);
    updateSelection({
      ...current,
      activeIndex:
        activeIndex >= 0
          ? activeIndex
          : current.activeIndex + previous.startOffset - startOffset,
    });
  }, [oids, startOffset, viewEpoch, loading, reader, query, updateSelection]);
  const selected = useMemo(
    () => new Set(selection.selectedOids),
    [selection.selectedOids],
  );
  const select = (oid: string, mode: CommitGraphSelectionMode = "replace") => {
    const request = ++intent.current;
    const current = selectionRef.current;
    if (
      mode === "activate" &&
      needsReconciliation.current &&
      reader !== undefined &&
      query !== undefined
    ) {
      const active = selectGraphCommit(current, oids, oid, mode);
      updateSelection(active);
      void reconcileGraphQuerySelection(
        reader,
        query,
        active,
        startOffset,
        startOffset,
        oids,
        () => intent.current !== request,
      )
        .then((next) => {
          if (next !== undefined && intent.current === request) {
            needsReconciliation.current = false;
            updateSelection({
              ...next,
              activeIndex:
                next.activeIndex + startOffset - currentStartOffset.current,
            });
          }
        })
        .catch(() => {});
      return;
    }
    const needsQuery =
      mode === "toggle"
        ? current.selectedOids.some(
            (selectedOid) => !oids.includes(selectedOid),
          )
        : mode === "range" &&
          !oids.includes(current.anchorOid ?? current.activeOid ?? oid);
    if (needsQuery && reader !== undefined && query !== undefined) {
      updateSelection(selectGraphCommit(current, oids, oid, "activate"));
      void selectGraphQueryCommit(
        reader,
        query,
        current,
        oid,
        mode,
        startOffset,
        () => intent.current !== request,
      )
        .then((next) => {
          if (next !== undefined && intent.current === request) {
            needsReconciliation.current = false;
            updateSelection({
              ...next,
              activeIndex:
                next.activeIndex + startOffset - currentStartOffset.current,
            });
          }
        })
        .catch(() => {});
      return;
    }
    needsReconciliation.current = false;
    updateSelection(selectGraphCommit(current, oids, oid, mode));
  };
  return {
    selection,
    selected,
    select,
    cancelPending: () => {
      intent.current += 1;
    },
    clear: () => {
      intent.current += 1;
      updateSelection(clearGraphSelection(selectionRef.current));
    },
    selectAll: () => {
      intent.current += 1;
      updateSelection({ ...selectionRef.current, selectedOids: oids });
    },
    reset: () => {
      intent.current += 1;
      updateSelection(emptyCommitGraphSelection);
    },
  };
}
