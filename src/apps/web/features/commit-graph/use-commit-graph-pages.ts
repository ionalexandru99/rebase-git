import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { CommitGraphViewportAnchor } from "#web/features/commit-graph/commit-graph.contract";
import {
  createCommitGraphPageWindow,
  emptyCommitGraphPageWindowSnapshot as emptyPages,
} from "#web/features/commit-graph/paging/commit-graph-page-window";
import type { CommitGraphPageWindow } from "#web/features/commit-graph/paging/commit-graph-page-window.contract";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";

const emptyHistorySnapshot = {
  revision: 0,
  historyRevision: 0,
  status: "empty",
} as const;
const noSubscription = () => () => undefined;

export function useCommitGraphPages(
  reader: RepositoryHistoryReader | undefined,
  roots: RepositoryHistoryQuery["roots"] | undefined,
  order: RepositoryHistoryQuery["order"],
  expanded: ReadonlyMap<string, readonly string[]>,
  captureAnchor: () => CommitGraphViewportAnchor | undefined,
) {
  const [owner, setOwner] = useState<{
    reader: RepositoryHistoryReader;
    engine: CommitGraphPageWindow;
  }>();
  const [refOwner, setRefOwner] = useState<{
    reader: RepositoryHistoryReader;
    refs: readonly RepositoryHistoryRefTarget[];
  }>();
  const [completion, setCompletion] = useState(0);
  const engine = owner?.reader === reader ? owner?.engine : undefined;
  const snapshot = useSyncExternalStore(
    engine?.subscribe ?? noSubscription,
    engine?.getSnapshot ?? (() => emptyPages),
  );
  const historySnapshot = useSyncExternalStore(
    reader?.subscribe ?? noSubscription,
    reader?.getSnapshot ?? (() => emptyHistorySnapshot),
  );
  const previousSynchronization = useRef(historySnapshot.synchronization);
  const capture = useRef(captureAnchor);
  capture.current = captureAnchor;
  const refTargets = refOwner?.reader === reader ? (refOwner?.refs ?? []) : [];

  useEffect(() => {
    if (reader === undefined) return;
    const created = createCommitGraphPageWindow(reader);
    setOwner({ reader, engine: created });
    return () => created.dispose();
  }, [reader]);
  useEffect(() => {
    if (reader === undefined) return;
    const revision = historySnapshot.historyRevision;
    let current = true;
    void reader
      .getRefTargets()
      .then((refs) => {
        if (current && reader.getSnapshot().historyRevision === revision)
          setRefOwner((previous) =>
            previous?.reader === reader &&
            JSON.stringify(previous.refs) === JSON.stringify(refs)
              ? previous
              : { reader, refs },
          );
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [reader, historySnapshot.historyRevision]);
  useEffect(() => {
    if (
      previousSynchronization.current !== "complete" &&
      historySnapshot.synchronization === "complete"
    )
      setCompletion((value) => value + 1);
    previousSynchronization.current = historySnapshot.synchronization;
  }, [historySnapshot.synchronization]);

  const resolvedRoots = roots?.map(
    (root) =>
      refTargets.find(
        (ref) => ref.name === root.name && ref.type === root.type,
      ) ?? root,
  );
  const nextQuery =
    resolvedRoots === undefined
      ? undefined
      : {
          limit: 100,
          offset: 0,
          roots: resolvedRoots,
          order,
          ancestry: "first-parent" as const,
          additionalParentEdges: [...expanded].flatMap(([childOid, parents]) =>
            parents.map((parentOid) => ({ childOid, parentOid })),
          ),
        };
  const key = JSON.stringify(nextQuery);
  const query = useRef<{
    key: string | undefined;
    value: RepositoryHistoryQuery | undefined;
  }>({ key: undefined, value: undefined });
  if (query.current.key !== key) query.current = { key, value: nextQuery };
  const stableQuery = query.current.value;
  const previousCompletion = useRef(completion);
  useEffect(() => {
    if (engine === undefined || stableQuery === undefined) return;
    const refreshed = previousCompletion.current !== completion;
    previousCompletion.current = completion;
    if (
      !refreshed &&
      JSON.stringify(engine.getSnapshot().query) === JSON.stringify(stableQuery)
    )
      return;
    const anchor = capture.current();
    void engine.reload(stableQuery, anchor?.oid);
  }, [engine, stableQuery, completion]);

  const commits = useMemo(
    () => snapshot.pages.flatMap((page) => page.commits),
    [snapshot.pages],
  );
  const laneRows = useMemo(
    () => snapshot.pages.flatMap((page) => page.rows),
    [snapshot.pages],
  );
  const merges = useMemo(
    () => new Map(snapshot.pages.flatMap((page) => [...page.merges])),
    [snapshot.pages],
  );
  return {
    engine,
    snapshot,
    historySnapshot,
    refTargets,
    roots: stableQuery?.roots,
    commits,
    laneRows,
    merges,
    loading:
      engine === undefined || stableQuery === undefined || snapshot.loading,
    reload: () => {
      if (engine !== undefined && stableQuery !== undefined) {
        const anchor = capture.current();
        void engine.reload(stableQuery, anchor?.oid);
      }
    },
  };
}
