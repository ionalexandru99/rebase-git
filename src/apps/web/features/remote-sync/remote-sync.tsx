import { IconArrowBarToDown, IconArrowDown } from "@tabler/icons-react";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { ToolbarButton } from "#web/components/ui/toolbar-button";
import { ErrorNotification } from "#web/features/notifications/components/error-notification";
import { useOperationCommandState } from "#web/features/operation-recovery/hooks/use-operation-status";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs";
import { describeRepositoryFetchError } from "#web/features/remote-sync/fetch-settings";
import {
  type Push,
  PushButton,
  PushNotice,
  usePush,
} from "#web/features/remote-sync/push";
import { resolvePushTarget } from "#web/features/remote-sync/push-target";
import {
  type Pull,
  type PullReader,
  useHistorySnapshot,
  usePull,
} from "#web/features/remote-sync/use-pull";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/repository-history-reader";
import { useRepositoryScope } from "#web/platform/query/repository-scope";

interface FetchAttempt {
  readonly reader: PullReader;
  readonly pending: boolean;
  readonly error?: string;
}

export function RemoteSync({
  reader,
  children,
}: {
  readonly reader: PullReader | undefined;
  readonly children: (actions: ReactNode) => ReactNode;
}) {
  const pull = usePull(reader);
  const push = usePush();
  return (
    <>
      <PushNotice push={push} />
      {pull.error === undefined ? null : (
        <ErrorNotification message={pull.error} />
      )}
      {children(<SyncActions reader={reader} pull={pull} push={push} />)}
    </>
  );
}

function SyncActions({
  reader,
  pull,
  push,
}: {
  readonly reader: PullReader | undefined;
  readonly pull: Pull;
  readonly push: Push;
}) {
  const snapshot = useHistorySnapshot(reader);
  const fetch = useFetch(reader, snapshot);
  const scope = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  const recoveryBusy = useOperationCommandState() === "busy";
  const activeBranch =
    refs === undefined || scope === undefined
      ? undefined
      : activeHead(refs, scope.worktreePath)?.branch;
  const incoming =
    refs?.branches.find(({ name }) => name === activeBranch)?.upstream
      ?.behind ?? 0;
  const pushTarget = resolvePushTarget(refs, activeBranch);
  const ready =
    pull.canRun && pull.freshnessReady && !recoveryBusy && !pull.pulling;
  return (
    <>
      <ToolbarButton
        disabled={!ready || fetch.fetching}
        onClick={fetch.execute}
      >
        <IconArrowDown aria-hidden="true" className="size-3.5" />
        {fetch.fetching ? "Fetching" : "Fetch"}
      </ToolbarButton>
      {pull.available ? (
        <ToolbarButton
          aria-label={pullLabel(pull.pulling, incoming)}
          disabled={!ready || activeBranch === undefined}
          onClick={() => {
            if (activeBranch !== undefined) void pull.pull(activeBranch);
          }}
        >
          <IconArrowBarToDown aria-hidden="true" className="size-3.5" />
          {pull.pulling ? "Pulling" : "Pull"}
          {pull.pulling || incoming === 0 ? null : (
            <span
              aria-hidden="true"
              className="rounded-full bg-primary/15 px-1.5 text-[.75rem] leading-[1.15rem] text-primary tabular-nums"
            >
              {incoming}
            </span>
          )}
        </ToolbarButton>
      ) : null}
      {scope === undefined || pushTarget === undefined ? null : (
        <PushButton
          push={push}
          target={pushTarget}
          operationBusy={recoveryBusy}
        />
      )}
      <FreshnessNotice
        error={fetch.error}
        fetching={fetch.fetching}
        snapshot={snapshot}
      />
    </>
  );
}

function useFetch(
  reader: PullReader | undefined,
  snapshot: RepositoryHistorySnapshot,
) {
  const pending = useRef(new Set<PullReader>());
  const [attempt, setAttempt] = useState<FetchAttempt>();
  const execute = useCallback(() => {
    if (
      reader === undefined ||
      pending.current.has(reader) ||
      snapshot.freshness?.fetching
    )
      return;
    pending.current.add(reader);
    setAttempt({ reader, pending: true });
    void reader
      .fetch()
      .then(
        () => {
          setAttempt({ reader, pending: false });
        },
        (error: unknown) => {
          setAttempt({
            reader,
            pending: false,
            error: describeRepositoryFetchError(error),
          });
        },
      )
      .finally(() => pending.current.delete(reader));
  }, [reader, snapshot.freshness?.fetching]);
  return {
    execute,
    fetching:
      snapshot.freshness?.fetching === true ||
      (attempt?.reader === reader && attempt?.pending === true),
    error: attempt?.reader === reader ? attempt?.error : undefined,
  };
}

function FreshnessNotice({
  snapshot,
  fetching,
  error,
}: {
  readonly snapshot: RepositoryHistorySnapshot;
  readonly fetching: boolean;
  readonly error: string | undefined;
}) {
  if (fetching) return null;
  if (snapshot.freshnessError?._tag === "RepositoryHistoryOffline")
    return <ErrorNotification message="You're offline" />;
  if (snapshot.freshnessError !== undefined)
    return <ErrorNotification message="Fetching unavailable" />;
  if (error !== undefined || snapshot.freshness?.stale === true)
    return <ErrorNotification message="Fetch failed" />;
  return null;
}

function pullLabel(pulling: boolean, incoming: number) {
  if (pulling) return "Pulling";
  if (incoming === 0) return "Pull";
  return `Pull ${incoming} incoming ${incoming === 1 ? "commit" : "commits"}`;
}
