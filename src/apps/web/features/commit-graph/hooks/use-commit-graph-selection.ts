import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { HistoryScopeQuery } from "#web/features/repository-history/history-view";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history";

export type CommitGraphSelectionMode =
  | "replace"
  | "toggle"
  | "range"
  | "activate";

export interface CommitGraphSelection {
  readonly selectedOids: readonly string[];
  readonly activeOid?: string;
  readonly activeIndex: number;
  readonly anchorOid?: string;
  readonly anchorIndex?: number;
}

const emptySelection: CommitGraphSelection = {
  selectedOids: [],
  activeIndex: 0,
};

export interface ResidentRows {
  readonly oidAt: (index: number) => string | undefined;
  readonly indexOf: (oid: string) => number | undefined;
  readonly oids: () => readonly string[];
}

export function useCommitGraphSelection({
  history,
  scope,
  version,
  total,
  resident,
  pageSize,
  merges,
  toggleMerge,
  scrollToIndex,
  onSelectionIntent,
  onActiveCommitChange,
}: {
  readonly history: RepositoryHistory | undefined;
  readonly scope: HistoryScopeQuery | undefined;
  readonly version: string | undefined;
  readonly total: number;
  readonly resident: ResidentRows;
  readonly pageSize: number;
  readonly merges: ReadonlyMap<string, "collapsed" | "expanded">;
  readonly toggleMerge: (oid: string, expand: boolean) => void;
  readonly scrollToIndex: (index: number) => void;
  readonly onSelectionIntent?: () => void;
  readonly onActiveCommitChange?:
    | ((oid: string | undefined) => void)
    | undefined;
}) {
  const [selection, setSelection] = useState(emptySelection);
  const current = useRef(selection);
  const intent = useRef(0);
  const activeChanged = useRef(onActiveCommitChange);
  activeChanged.current = onActiveCommitChange;
  const update = useCallback((next: CommitGraphSelection) => {
    const previous = current.current.activeOid;
    current.current = next;
    setSelection(next);
    if (next.activeOid !== previous) activeChanged.current?.(next.activeOid);
  }, []);
  const oidsBetween = useCallback(
    async (from: number, to: number) => {
      const oids: string[] = [];
      for (let index = from; index <= to; index += 1) {
        const oid = resident.oidAt(index);
        if (oid === undefined) break;
        oids.push(oid);
      }
      if (oids.length === to - from + 1) return oids;
      if (history === undefined || scope === undefined) return undefined;
      return history.ask({ _tag: "Oids", scope, start: from, end: to + 1 });
    },
    [history, resident, scope],
  );

  const latest = useRef({ history, scope, total, oidsBetween });
  latest.current = { history, scope, total, oidsBetween };
  useEffect(() => {
    if (version === undefined) return;
    const request = ++intent.current;
    const { history, scope, total, oidsBetween } = latest.current;
    void reconcile(history, scope, current.current, total, oidsBetween).then(
      (next) => {
        if (next !== undefined && request === intent.current) update(next);
      },
      () => undefined,
    );
  }, [version, update]);

  const select = (
    oid: string,
    index: number,
    mode: CommitGraphSelectionMode = "replace",
  ) => {
    const request = ++intent.current;
    const state = current.current;
    if (mode !== "range") {
      update(selectCommit(state, oid, index, mode));
      return;
    }
    const anchorIndex = state.anchorIndex ?? index;
    const anchorOid = state.anchorOid ?? oid;
    update({ ...state, activeOid: oid, activeIndex: index });
    void oidsBetween(
      Math.min(anchorIndex, index),
      Math.max(anchorIndex, index),
    ).then(
      (oids) => {
        if (oids === undefined || request !== intent.current) return;
        update({
          selectedOids: oids,
          activeOid: oid,
          activeIndex: index,
          anchorOid,
          anchorIndex,
        });
      },
      () => undefined,
    );
  };

  const move = (target: number, mode: CommitGraphSelectionMode = "replace") => {
    if (total === 0) return;
    const index = Math.max(0, Math.min(total - 1, target));
    const oid = resident.oidAt(index);
    onSelectionIntent?.();
    scrollToIndex(index);
    if (oid !== undefined) {
      select(oid, index, mode);
      return;
    }
    const request = ++intent.current;
    void oidsBetween(index, index).then(
      (oids) => {
        const found = oids?.[0];
        if (found !== undefined && request === intent.current)
          select(found, index, mode);
      },
      () => undefined,
    );
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    const { activeOid, activeIndex } = current.current;
    if (
      (event.key === "ArrowRight" || event.key === "ArrowLeft") &&
      activeOid !== undefined &&
      merges.has(activeOid)
    ) {
      event.preventDefault();
      toggleMerge(activeOid, event.key === "ArrowRight");
      return;
    }
    const modifier = event.metaKey || event.ctrlKey;
    const mode = event.shiftKey ? "range" : modifier ? "activate" : "replace";
    const destination =
      event.key === "ArrowDown"
        ? activeIndex + 1
        : event.key === "ArrowUp"
          ? activeIndex - 1
          : event.key === "PageDown"
            ? activeIndex + pageSize
            : event.key === "PageUp"
              ? activeIndex - pageSize
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? total - 1
                  : undefined;
    if (destination !== undefined) {
      event.preventDefault();
      move(destination, mode);
    } else if (
      (event.key === " " || event.key === "Enter") &&
      activeOid !== undefined
    ) {
      event.preventDefault();
      onSelectionIntent?.();
      select(
        activeOid,
        activeIndex,
        event.key === " " ? (event.shiftKey ? "range" : "toggle") : "replace",
      );
    } else if (event.key === "Escape") {
      event.preventDefault();
      onSelectionIntent?.();
      intent.current += 1;
      update({ ...current.current, selectedOids: [] });
    } else if (modifier && event.key.toLowerCase() === "a") {
      event.preventDefault();
      onSelectionIntent?.();
      intent.current += 1;
      update({ ...current.current, selectedOids: resident.oids() });
    }
  };

  const onClick = (oid: string, event: MouseEvent) => {
    const index = resident.indexOf(oid);
    if (index === undefined) return;
    onSelectionIntent?.();
    select(
      oid,
      index,
      event.shiftKey
        ? "range"
        : event.metaKey || event.ctrlKey
          ? "toggle"
          : "replace",
    );
  };

  const selected = useMemo(
    () => new Set(selection.selectedOids),
    [selection.selectedOids],
  );
  return {
    selection,
    selected,
    select,
    move,
    onKeyDown,
    onClick,
    cancel: () => {
      intent.current += 1;
    },
  };
}

function selectCommit(
  state: CommitGraphSelection,
  oid: string,
  index: number,
  mode: Exclude<CommitGraphSelectionMode, "range">,
): CommitGraphSelection {
  if (mode === "activate")
    return { ...state, activeOid: oid, activeIndex: index };
  if (mode === "replace")
    return {
      selectedOids: [oid],
      activeOid: oid,
      activeIndex: index,
      anchorOid: oid,
      anchorIndex: index,
    };
  const selected = state.selectedOids.includes(oid)
    ? state.selectedOids.filter((candidate) => candidate !== oid)
    : [...state.selectedOids, oid];
  return {
    selectedOids: selected,
    activeOid: oid,
    activeIndex: index,
    anchorOid: oid,
    anchorIndex: index,
  };
}

async function reconcile(
  history: RepositoryHistory | undefined,
  scope: HistoryScopeQuery | undefined,
  state: CommitGraphSelection,
  total: number,
  oidsBetween: (
    from: number,
    to: number,
  ) => Promise<readonly string[] | undefined>,
): Promise<CommitGraphSelection | undefined> {
  if (history === undefined || scope === undefined) return undefined;
  if (total === 0) return emptySelection;
  const tracked = [
    ...new Set([
      ...state.selectedOids,
      ...(state.activeOid === undefined ? [] : [state.activeOid]),
      ...(state.anchorOid === undefined ? [] : [state.anchorOid]),
    ]),
  ];
  const located =
    tracked.length === 0
      ? []
      : await history.ask({ _tag: "Locate", scope, oids: tracked });
  const positions = new Map(
    tracked.flatMap((oid, index) => {
      const row = located[index];
      return row === undefined ? [] : [[oid, row] as const];
    }),
  );
  const activeRow =
    state.activeOid === undefined ? undefined : positions.get(state.activeOid);
  const activeIndex =
    activeRow ?? Math.max(0, Math.min(state.activeIndex, total - 1));
  const activeOid =
    activeRow !== undefined
      ? state.activeOid
      : (await oidsBetween(activeIndex, activeIndex))?.[0];
  const anchorRow =
    state.anchorOid === undefined ? undefined : positions.get(state.anchorOid);
  return {
    selectedOids: state.selectedOids
      .filter((oid) => positions.has(oid))
      .sort(
        (left, right) =>
          (positions.get(left) ?? 0) - (positions.get(right) ?? 0),
      ),
    activeIndex,
    ...(activeOid === undefined ? {} : { activeOid }),
    ...(anchorRow === undefined || state.anchorOid === undefined
      ? activeOid === undefined
        ? {}
        : { anchorOid: activeOid, anchorIndex: activeIndex }
      : { anchorOid: state.anchorOid, anchorIndex: anchorRow }),
  };
}
