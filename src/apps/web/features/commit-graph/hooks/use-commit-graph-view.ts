import {
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { RepositoryHistoryRefTarget } from "#contracts/repository-history/repository-history.contract.ts";
import type { CommitGraphViewportHandle } from "#web/features/commit-graph/components/commit-graph-virtual-window.tsx";
import { historyLabelTarget } from "#web/features/commit-graph/components/commit-ref-labels.tsx";
import {
  type CommitGraphSelectionMode,
  useCommitGraphSelection,
} from "#web/features/commit-graph/hooks/use-commit-graph-selection.ts";
import { useGraphRows } from "#web/features/commit-graph/hooks/use-graph-rows.ts";
import type { HistorySelection } from "#web/features/commit-graph/scope/history-scope.ts";
import type { FarEdgeEnd } from "#web/features/repository-history/commit-lanes.ts";
import { useRepositoryHistoryOrder } from "#web/features/repository-history/history-order.ts";
import type { HistoryScopeQuery } from "#web/features/repository-history/history-view.ts";
import {
  emptyHistorySnapshot,
  type RepositoryHistory,
} from "#web/features/repository-history/repository-history.ts";
import { createStore } from "#web/platform/store/store.ts";
import { useStore } from "#web/platform/store/use-store.ts";

const emptyHistory = createStore(emptyHistorySnapshot);

export function useCommitGraphView({
  history,
  historyIdentity,
  roots,
  scrollRef,
  viewportRef,
  onRevealHistoryRef,
  onActiveCommitChange,
}: {
  readonly history: RepositoryHistory | undefined;
  readonly historyIdentity:
    | { readonly environmentId: string; readonly repositoryId: string }
    | undefined;
  readonly roots: readonly RepositoryHistoryRefTarget[] | undefined;
  readonly scrollRef: RefObject<HTMLTableElement | null>;
  readonly viewportRef: RefObject<CommitGraphViewportHandle | null>;
  readonly onRevealHistoryRef: ((target: HistorySelection) => void) | undefined;
  readonly onActiveCommitChange:
    | ((oid: string | undefined) => void)
    | undefined;
}) {
  const [expanded, setExpanded] = useState<
    ReadonlyMap<string, readonly string[]>
  >(new Map());
  const order = useRepositoryHistoryOrder(
    historyIdentity?.environmentId,
    historyIdentity?.repositoryId,
  );
  const snapshot = useStore(history ?? emptyHistory);
  const [pageSize, setPageSize] = useState(12);
  const [range, setRange] = useState({ first: 0, last: 40 });
  const [pending, setPending] = useState<{
    readonly oid: string;
    readonly mode: CommitGraphSelectionMode;
  }>();
  const scopeQuery = useMemo<HistoryScopeQuery | undefined>(
    () =>
      roots === undefined
        ? undefined
        : {
            roots,
            order,
            expanded: [...expanded].flatMap(([childOid, parents]) =>
              parents.map((parentOid) => ({ childOid, parentOid })),
            ),
          },
    [roots, order, expanded],
  );
  const activeOid = useRef<string | undefined>(undefined);
  const rows = useGraphRows({
    history,
    scope: scopeQuery,
    revision: snapshot.revision,
    first: range.first,
    last: range.last,
    scrollRef,
    activeOid,
  });
  const answer = rows.answer;
  const current = rows.loading ? undefined : answer;
  const start = answer?.start ?? 0;
  const windowRows = answer?.rows ?? [];
  const total = answer?.total ?? 0;
  const laneRows = useMemo(
    () => windowRows.map((row) => row.lane),
    [windowRows],
  );
  const oids = useMemo(
    () => windowRows.map((row) => row.commit.oid),
    [windowRows],
  );
  const merges = useMemo(
    () =>
      new Map(
        windowRows.flatMap((row) =>
          row.merge === undefined
            ? []
            : [
                [
                  row.commit.oid,
                  expanded.has(row.commit.oid)
                    ? ("expanded" as const)
                    : ("collapsed" as const),
                ] as const,
              ],
        ),
      ),
    [windowRows, expanded],
  );
  const shownMerges = useMemo(
    () =>
      new Map(
        windowRows.flatMap((row) =>
          row.merge === undefined ? [] : [[row.commit.oid, row.merge] as const],
        ),
      ),
    [windowRows],
  );
  const farEdgeEnds = useMemo(() => {
    const ends = new Map<string, string>();
    for (const { lane } of windowRows)
      for (const { far } of [...lane.lanesBefore, ...lane.lanesAfter]) {
        const key =
          far === undefined ? undefined : `${far.from}\0${far.direction}`;
        if (key !== undefined && far !== undefined && !ends.has(key))
          ends.set(key, far.to);
      }
    return ends;
  }, [windowRows]);
  const resident = useMemo(
    () => ({
      oidAt: (index: number) =>
        current?.rows[index - current.start]?.commit.oid,
      indexOf: (oid: string) => {
        const found =
          current?.rows.findIndex((row) => row.commit.oid === oid) ?? -1;
        return found < 0 || current === undefined
          ? undefined
          : current.start + found;
      },
      oids: () => current?.rows.map((row) => row.commit.oid) ?? [],
    }),
    [current],
  );
  const navigationIntent = useRef(0);
  const beginNavigation = () => {
    navigationIntent.current += 1;
    navigation.cancel();
    setPending(undefined);
    return navigationIntent.current;
  };

  const toggleMerge = (oid: string, expand: boolean) => {
    const offset = windowRows.findIndex(
      (candidate) => candidate.commit.oid === oid,
    );
    const row = windowRows[offset];
    const index = start + offset;
    if (row === undefined || row.commit.parents.length < 2) return;
    beginNavigation();
    navigation.select(oid, index, "activate");
    setExpanded((previous) => {
      if (expand === previous.has(oid)) return previous;
      const next = new Map(previous);
      if (expand) next.set(oid, row.commit.parents.slice(1));
      else next.delete(oid);
      return next;
    });
    scrollRef.current?.focus();
  };

  const followFarEdge = (oid: string, direction: FarEdgeEnd["direction"]) => {
    const target = farEdgeEnds.get(`${oid}\0${direction}`);
    if (target === undefined) return false;
    void navigateToOid(target).catch(() => undefined);
    return true;
  };

  const navigation = useCommitGraphSelection({
    history,
    scope: current?.scope,
    version:
      current === undefined ? undefined : `${current.key}\0${current.revision}`,
    total: current?.total ?? 0,
    resident,
    pageSize,
    merges,
    toggleMerge,
    followFarEdge,
    scrollToIndex: (index) => viewportRef.current?.scrollToIndex(index),
    onSelectionIntent: () => beginNavigation(),
    onActiveCommitChange,
  });
  activeOid.current = navigation.selection.activeOid;

  useEffect(() => {
    if (pending === undefined || history === undefined || current === undefined)
      return;
    const intent = navigationIntent.current;
    void history
      .ask({ _tag: "Locate", scope: current.scope, oids: [pending.oid] })
      .then(
        ([index]) => {
          if (index === undefined || intent !== navigationIntent.current)
            return;
          setPending(undefined);
          navigation.select(pending.oid, index, pending.mode);
          viewportRef.current?.scrollToIndex(index);
        },
        () => undefined,
      );
  }, [
    pending,
    history,
    current,
    navigation.select,
    viewportRef.current?.scrollToIndex,
  ]);

  const navigateToOid = async (oid: string, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    const intent = beginNavigation();
    if (history === undefined || scopeQuery === undefined)
      throw new Error("This commit is outside the selected history.");
    const target = await history.ask(
      { _tag: "Find", scope: scopeQuery, oid },
      signal,
    );
    signal?.throwIfAborted();
    if (intent !== navigationIntent.current) return;
    if (target === undefined)
      throw new Error("This commit is outside the selected history.");
    const root = target.root;
    const selection = root === undefined ? undefined : historyLabelTarget(root);
    if (selection !== undefined) onRevealHistoryRef?.(selection);
    if (target.expanded.length > 0)
      setExpanded((previous) => {
        const next = new Map(previous);
        for (const edge of target.expanded)
          next.set(edge.childOid, [
            ...new Set([...(next.get(edge.childOid) ?? []), edge.parentOid]),
          ]);
        return next;
      });
    setPending({ oid, mode: "replace" });
    scrollRef.current?.focus();
  };
  const focusSelection = () => {
    if (navigation.selection.activeOid !== undefined)
      viewportRef.current?.scrollToIndex(navigation.selection.activeIndex);
    scrollRef.current?.focus();
  };
  const activeCommitOid =
    navigation.selection.activeOid !== undefined &&
    oids.includes(navigation.selection.activeOid)
      ? navigation.selection.activeOid
      : undefined;
  const onRange = useCallback(
    (first: number, last: number) =>
      setRange((previous) =>
        previous.first === first && previous.last === last
          ? previous
          : { first, last },
      ),
    [],
  );
  return {
    snapshot,
    rows,
    scopeQuery,
    start,
    total,
    windowRows,
    laneRows,
    oids,
    merges,
    shownMerges,
    resident,
    navigation,
    activeCommitOid,
    beginNavigation,
    toggleMerge,
    navigateToOid,
    focusSelection,
    onRange,
    setPageSize,
  };
}
