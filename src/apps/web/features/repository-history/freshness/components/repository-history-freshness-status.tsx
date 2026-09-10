import { ErrorNotification } from "#web/features/notifications/index";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/repository-history-reader.contract";

export function RepositoryHistoryFreshnessStatus({
  snapshot,
  fetching = snapshot.freshness?.fetching === true,
  error,
}: {
  readonly snapshot: RepositoryHistorySnapshot;
  readonly fetching?: boolean;
  readonly error?: string | undefined;
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
