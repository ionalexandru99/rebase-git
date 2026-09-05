import type { RepositoryCommit } from "@rebase/contracts";
import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import type {
  CommitGraphViewportAnchor,
  CommitGraphViewportHandle,
} from "#web/features/commit-graph/commit-graph.contract";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";

const rowHeight = 36;

export function useCommitGraphViewport({
  reader,
  order,
  selectedOidRef,
  commits,
  startOffset,
  loading,
}: {
  readonly reader: RepositoryHistoryReader | undefined;
  readonly order: RepositoryHistoryQuery["order"];
  readonly selectedOidRef: RefObject<string | undefined>;
  readonly commits: readonly RepositoryCommit[];
  readonly startOffset: number;
  readonly loading: boolean;
}) {
  const scrollRef = useRef<HTMLTableElement>(null);
  const viewportRef = useRef<CommitGraphViewportHandle>(null);
  const previousOrder = useRef(order);
  const previousReader = useRef(reader);
  const pendingAnchor = useRef<CommitGraphViewportAnchor | undefined>(
    undefined,
  );
  const committedWindow = useRef({ commits, start: startOffset });
  const captureAnchor = useCallback(() => {
    const current = committedWindow.current;
    let anchor = viewportAnchor(
      viewportRef.current?.getScrollOffset() ?? 0,
      current.commits,
      current.start,
    );
    if (previousOrder.current !== order && selectedOidRef.current !== undefined)
      anchor = { oid: selectedOidRef.current, offset: 0 };
    previousOrder.current = order;
    pendingAnchor.current = anchor;
    return anchor;
  }, [order, selectedOidRef]);
  useEffect(() => {
    if (previousReader.current === reader) return;
    previousReader.current = reader;
    pendingAnchor.current = undefined;
    if (scrollRef.current !== null) scrollRef.current.scrollTop = 0;
  }, [reader]);
  useLayoutEffect(() => {
    committedWindow.current = { commits, start: startOffset };
    const anchor = pendingAnchor.current;
    const element = scrollRef.current;
    if (anchor === undefined || element === null || loading) return;
    pendingAnchor.current = undefined;
    const index = commits.findIndex((commit) => commit.oid === anchor.oid);
    if (index >= 0)
      element.scrollTop = (startOffset + index) * rowHeight + anchor.offset;
  }, [commits, startOffset, loading]);
  return { scrollRef, viewportRef, captureAnchor };
}

function viewportAnchor(
  scrollTop: number,
  commits: readonly RepositoryCommit[],
  startOffset = 0,
): CommitGraphViewportAnchor | undefined {
  if (scrollTop <= 0) {
    return undefined;
  }
  const index = Math.floor(scrollTop / rowHeight);
  const commit = commits[index - startOffset];
  return commit === undefined
    ? undefined
    : { oid: commit.oid, offset: scrollTop - index * rowHeight };
}
