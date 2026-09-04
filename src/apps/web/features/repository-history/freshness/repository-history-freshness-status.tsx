import type { RepositoryFetchAction } from "#web/features/repository-history/freshness/repository-fetch-action.contract";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/repository-history-reader.contract";
import { Button } from "#web-ui/components/ui/button";
import { formatFetchInterval } from "#web-ui/features/repository-history/freshness/repository-fetch-settings";

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
  const text = offline
    ? "Offline. Cached history is available."
    : fetching
      ? "Fetching"
      : (error ??
        (failed
          ? "Fetch failed. Cached history is available."
          : describeAutomaticFetch(snapshot)));
  return (
    <div
      className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-border/60 border-t px-3 py-1 text-[10px] text-muted-foreground"
      role="status"
    >
      {snapshot.storingCommits && snapshot.synchronization === "syncing" ? (
        <span
          className="inline-flex items-center gap-1.5"
          title={`${snapshot.synchronizedCommitCount ?? 0} commits stored`}
        >
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
          title={fetchAction.disabledReason ?? fetchAction.shortcut}
          variant="ghost"
        >
          Retry fetch
        </Button>
      ) : null}
    </div>
  );
}

function describeAutomaticFetch(snapshot: RepositoryHistorySnapshot) {
  if (snapshot.freshnessError !== undefined)
    return "Fetching is unavailable. Cached history is available.";
  const freshness = snapshot.freshness;
  if (freshness === undefined) return "Cached history is available.";
  if (freshness.setting._tag === "Disabled") return "Automatic fetch off";
  const seconds =
    freshness.setting._tag === "Interval"
      ? freshness.setting.seconds
      : freshness.defaultIntervalSeconds;
  return `Automatic fetch every ${formatFetchInterval(seconds)}`;
}
