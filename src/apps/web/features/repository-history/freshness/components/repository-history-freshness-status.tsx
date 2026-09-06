import type { RepositoryFetchAction } from "#web/features/repository-history/freshness/repository-fetch-action.contract";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/repository-history-reader.contract";
import { Button } from "#web-ui/components/ui/button";

export function RepositoryHistoryFreshnessStatus({
  snapshot,
  fetchAction,
  fetching = snapshot.freshness?.fetching === true,
  error,
}: {
  readonly snapshot: RepositoryHistorySnapshot;
  readonly fetchAction: RepositoryFetchAction;
  readonly fetching?: boolean;
  readonly error?: string | undefined;
}) {
  const offline = snapshot.freshnessError?._tag === "RepositoryHistoryOffline";
  const failed = error !== undefined || snapshot.freshness?.stale === true;
  if (!failed && snapshot.freshnessError === undefined) return null;
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
    <div className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-border/60 border-t px-3 py-1 text-[.85rem] text-muted-foreground">
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-1"
        role="status"
      >
        <span
          className={failed && !offline ? "text-status-connecting" : undefined}
        >
          {text}
        </span>
        {failed && !offline && !fetching ? (
          <Button
            aria-keyshortcuts={fetchAction.ariaKeyShortcuts}
            className="h-5 px-1.5 text-[.85rem] sm:h-5 sm:text-[.85rem]"
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
