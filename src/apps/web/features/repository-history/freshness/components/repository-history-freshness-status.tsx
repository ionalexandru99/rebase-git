import type { RepositoryFetchAction } from "#web/features/repository-history/freshness/repository-fetch-action.contract";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/repository-history-reader.contract";
import { Button } from "#web-ui/components/ui/button";

export function RepositoryHistoryFreshnessStatus({
  snapshot,
  fetchAction,
  fetching = snapshot.freshness?.fetching === true,
  error,
  selectedCount,
}: {
  readonly snapshot: RepositoryHistorySnapshot;
  readonly fetchAction: RepositoryFetchAction;
  readonly fetching?: boolean;
  readonly error?: string | undefined;
  readonly selectedCount?: number | undefined;
}) {
  const offline = snapshot.freshnessError?._tag === "RepositoryHistoryOffline";
  const failed = error !== undefined || snapshot.freshness?.stale === true;
  const text = offline
    ? `Offline. ${describeCachedHistory(snapshot)}`
    : fetching
      ? "Fetching"
      : (error ??
        (snapshot.freshnessError !== undefined
          ? `Fetching is unavailable. ${describeCachedHistory(snapshot)}`
          : failed
            ? `Fetch failed. ${describeCachedHistory(snapshot)}`
            : undefined));
  return (
    <div className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-border/60 border-t px-3 py-1 text-[10px] text-muted-foreground">
      {selectedCount === undefined ? null : (
        <span className="mr-auto">{selectedCount} selected</span>
      )}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
        role="status"
      >
        {snapshot.shallowOids?.length ? <span>Shallow history</span> : null}
        {snapshot.storingCommits && snapshot.synchronization === "syncing" ? (
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-full border border-primary/70 border-l-border"
            />
            Syncing
          </span>
        ) : null}
        <span
          className={failed && !offline ? "text-status-connecting" : undefined}
        >
          {text}
        </span>
        {failed && !offline && !fetching ? (
          <Button
            aria-keyshortcuts={fetchAction.ariaKeyShortcuts}
            className="h-5 px-1.5 text-[10px] sm:h-5 sm:text-[10px]"
            disabled={fetchAction.disabled}
            onClick={fetchAction.execute}
            size="xs"
            variant="ghost"
          >
            Retry fetch
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function describeCachedHistory(snapshot: RepositoryHistorySnapshot) {
  const hasHistory =
    snapshot.synchronizedCommitCount === undefined
      ? snapshot.status === "ready"
      : snapshot.synchronizedCommitCount > 0;
  return hasHistory
    ? "Cached history is available."
    : "No cached history is available.";
}
