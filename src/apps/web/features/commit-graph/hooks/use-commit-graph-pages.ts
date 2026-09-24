import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CommitGraphViewportAnchor } from "#web/features/commit-graph/commit-graph.contract";
import {
  createCommitGraphPageWindow,
  emptyCommitGraphPageWindowSnapshot as emptyPages,
} from "#web/features/commit-graph/paging/commit-graph-page-window";
import type { CommitGraphPageWindow } from "#web/features/commit-graph/paging/commit-graph-page-window.contract";
import {
  commitGraphQuery,
  historyQueriesEqual,
  refTargetsEqual,
} from "#web/features/commit-graph/paging/commit-graph-query";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReadModel,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/index";
import { createStore } from "#web/platform/store/store";
import { useStore } from "#web/platform/store/use-store";

const emptyPagesStore = createStore(emptyPages);
const emptyRefTargets: readonly RepositoryHistoryRefTarget[] = [];
const emptyHistoryStore = createStore<RepositoryHistorySnapshot>({
  revision: 0,
  historyRevision: 0,
  status: "empty",
});

export function useCommitGraphPages(
  reader: RepositoryHistoryReadModel | undefined,
  roots: RepositoryHistoryQuery["roots"] | undefined,
  order: RepositoryHistoryQuery["order"],
  expanded: ReadonlyMap<string, readonly string[]>,
  captureAnchor: () => CommitGraphViewportAnchor | undefined,
) {
  const [owner, setOwner] = useState<{
    reader: RepositoryHistoryReadModel;
    engine: CommitGraphPageWindow;
  }>();
  const [refOwner, setRefOwner] = useState<{
    reader: RepositoryHistoryReadModel;
    refs: readonly RepositoryHistoryRefTarget[];
  }>();
  const [completion, setCompletion] = useState(0);
  const engine = owner?.reader === reader ? owner?.engine : undefined;
  const snapshot = useStore(engine ?? emptyPagesStore);
  const historySnapshot = useStore(reader ?? emptyHistoryStore);
  const previousSynchronization = useRef(historySnapshot.synchronization);
  const previousHistoryRevision = useRef(historySnapshot.historyRevision);
  const capture = useRef(captureAnchor);
  capture.current = captureAnchor;
  const refTargets =
    refOwner !== undefined && refOwner.reader === reader
      ? refOwner.refs
      : emptyRefTargets;

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
            previous?.reader === reader && refTargetsEqual(previous.refs, refs)
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
      previousHistoryRevision.current !== historySnapshot.historyRevision &&
      historySnapshot.status === "empty" &&
      historySnapshot.synchronization === "idle"
    )
      engine?.discard();
    else if (
      previousSynchronization.current !== "complete" &&
      historySnapshot.synchronization === "complete"
    )
      setCompletion((value) => value + 1);
    previousSynchronization.current = historySnapshot.synchronization;
    previousHistoryRevision.current = historySnapshot.historyRevision;
  }, [
    engine,
    historySnapshot.historyRevision,
    historySnapshot.status,
    historySnapshot.synchronization,
  ]);

  const stableQuery = useMemo(
    () =>
      roots === undefined
        ? undefined
        : commitGraphQuery(roots, refTargets, order, expanded),
    [roots, refTargets, order, expanded],
  );
  const previousCompletion = useRef(completion);
  useEffect(() => {
    if (engine === undefined || stableQuery === undefined) return;
    const refreshed = previousCompletion.current !== completion;
    previousCompletion.current = completion;
    if (
      !refreshed &&
      historyQueriesEqual(engine.getSnapshot().requestedQuery, stableQuery)
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
