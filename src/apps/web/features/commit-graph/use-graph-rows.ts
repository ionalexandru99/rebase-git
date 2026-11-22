import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { graphRowHeight } from "#web/features/commit-graph/layout/graph-geometry.ts";
import type { HistoryScopeQuery } from "#web/features/repository-history/history-view.ts";
import type {
  HistoryFailure,
  HistoryRow,
} from "#web/features/repository-history/history-worker-protocol.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";

const margin = 200;
const prefetch = 100;

export interface GraphRowsAnswer {
  readonly history: RepositoryHistory;
  readonly key: string;
  readonly scope: HistoryScopeQuery;
  readonly revision: number;
  readonly total: number;
  readonly start: number;
  readonly end: number;
  readonly rows: readonly HistoryRow[];
  readonly shift: number;
  readonly sequence: number;
}

interface WantedRows {
  readonly history: RepositoryHistory | undefined;
  readonly scope: HistoryScopeQuery | undefined;
  readonly key: string | undefined;
  readonly revision: number;
  readonly first: number;
  readonly last: number;
}

export function useGraphRows({
  history,
  scope,
  revision,
  first,
  last,
  scrollRef,
  activeOid,
}: {
  readonly history: RepositoryHistory | undefined;
  readonly scope: HistoryScopeQuery | undefined;
  readonly revision: number;
  readonly first: number;
  readonly last: number;
  readonly scrollRef: RefObject<HTMLElement | null>;
  readonly activeOid: RefObject<string | undefined>;
}) {
  const key = scope === undefined ? undefined : JSON.stringify(scope);
  const [answer, setAnswer] = useState<GraphRowsAnswer>();
  const [failure, setFailure] = useState<HistoryFailure>();
  const wanted = useRef<WantedRows | undefined>(undefined);
  const shown = useRef(answer);
  const failed = useRef(false);
  const inFlight = useRef(false);
  const sequence = useRef(0);

  const request = useCallback(() => {
    const target = wanted.current;
    const current = shown.current;
    if (
      target === undefined ||
      inFlight.current ||
      failed.current ||
      target.history === undefined ||
      target.scope === undefined ||
      target.key === undefined ||
      (current?.history === target.history &&
        current.key === target.key &&
        current.revision === target.revision &&
        target.first >= (current.start === 0 ? 0 : current.start + prefetch) &&
        target.last <
          (current.end >= current.total ? current.end : current.end - prefetch))
    )
      return;
    inFlight.current = true;
    const {
      history: targetHistory,
      key: targetKey,
      scope: targetScope,
      revision: targetRevision,
    } = target;
    const moved =
      current?.history === targetHistory &&
      (current.key !== targetKey || current.revision !== targetRevision);
    const pinned = moved
      ? anchor(current, targetScope, scrollRef.current, activeOid.current)
      : undefined;
    const start = Math.max(0, target.first - margin);
    const end = target.last + margin + 1;
    void targetHistory
      .ask({
        _tag: "Rows",
        scope: targetScope,
        start,
        end,
        ...(pinned === undefined ? {} : { anchor: pinned }),
      })
      .then(
        (rows) => {
          inFlight.current = false;
          sequence.current += 1;
          const next = {
            history: targetHistory,
            key: targetKey,
            scope: targetScope,
            revision: targetRevision,
            total: rows.total,
            start: rows.start,
            end: end + rows.shift,
            rows: rows.rows,
            shift: rows.shift,
            sequence: sequence.current,
          };
          shown.current = next;
          setAnswer(next);
        },
        (error: HistoryFailure) => {
          inFlight.current = false;
          failed.current = true;
          setFailure(error);
        },
      );
  }, [scrollRef, activeOid]);

  useEffect(() => {
    wanted.current = { history, scope, key, revision, first, last };
    if (answer === shown.current) request();
  }, [history, scope, key, revision, first, last, answer, request]);

  const retry = () => {
    failed.current = false;
    setFailure(undefined);
    request();
  };

  const shifted = useRef(0);
  useLayoutEffect(() => {
    if (answer === undefined || shifted.current === answer.sequence) return;
    shifted.current = answer.sequence;
    const element = scrollRef.current;
    if (answer.shift !== 0 && element !== null)
      element.scrollTop += answer.shift * graphRowHeight;
  }, [answer, scrollRef]);

  const shownAnswer = answer?.history === history ? answer : undefined;
  const current = shownAnswer?.key === key ? shownAnswer : undefined;
  return {
    answer: shownAnswer,
    loading: current === undefined && failure === undefined,
    failure,
    retry,
  };
}

function anchor(
  shown: GraphRowsAnswer,
  scope: HistoryScopeQuery,
  element: HTMLElement | null,
  activeOid: string | undefined,
) {
  const scrollTop = element?.scrollTop ?? 0;
  const top = Math.floor(scrollTop / graphRowHeight);
  if (shown.scope.order !== scope.order && activeOid !== undefined)
    return { oid: activeOid, index: top };
  if (scrollTop <= 0) return undefined;
  const oid = shown.rows[top - shown.start]?.commit.oid;
  return oid === undefined ? undefined : { oid, index: top };
}
