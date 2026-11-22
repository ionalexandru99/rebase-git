import { ConfirmDialog } from "#web/components/ui/alert-dialog.tsx";
import { Button } from "#web/components/ui/button.tsx";
import { SettingsRow } from "#web/components/ui/settings-layout.tsx";
import { formatCacheSize } from "#web/features/history-storage/format-cache-size.ts";
import {
  historyCacheActions,
  useHistoryCacheManagement,
} from "#web/features/history-storage/use-history-cache-management.ts";

export function RepositoryCacheSettings(
  props: Parameters<typeof useHistoryCacheManagement>[0] & {
    readonly connected: boolean;
  },
) {
  const cache = useHistoryCacheManagement(props);
  const confirming =
    cache.confirmation === undefined
      ? undefined
      : historyCacheActions[cache.confirmation];
  const current = cache.diagnostics?.caches.find(
    ({ environmentId, repositoryId }) =>
      environmentId === props.identity.environmentId &&
      repositoryId === props.identity.repositoryId,
  );
  return (
    <>
      <SettingsRow
        title="Cached history"
        description={
          current === undefined
            ? cache.diagnostics === undefined
              ? "Reading storage…"
              : "No cached history"
            : `${current.commitCount.toLocaleString()} commits`
        }
        {...(current === undefined
          ? {}
          : { value: formatCacheSize(current.estimatedBytes) })}
      >
        <Button
          size="sm"
          variant="outline"
          aria-label="Rebuild cache"
          disabled={cache.pending || !props.connected}
          onClick={() => cache.setConfirmation("rebuild")}
        >
          Rebuild
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={cache.pending}
          onClick={() => cache.setConfirmation("clear")}
        >
          Clear cache
        </Button>
      </SettingsRow>
      {cache.exhausted || cache.storageUnavailable ? (
        <p
          role="alert"
          className="px-3 py-3 text-meta text-destructive sm:px-4"
        >
          {cache.exhausted
            ? "Browser storage is full."
            : "Browser storage is unavailable."}{" "}
          Clear unused history, then rebuild this cache.
        </p>
      ) : null}
      {cache.snapshot.failure !== undefined && !cache.storageUnavailable ? (
        <p
          role="alert"
          className="px-3 py-3 text-meta text-destructive sm:px-4"
        >
          {cache.snapshot.failure._tag === "Offline"
            ? "Reconnect to finish history synchronization."
            : "History synchronization failed. Rebuild the cache to retry."}
        </p>
      ) : null}
      {cache.pending ? (
        <p
          role="status"
          className="px-3 py-3 text-meta text-muted-foreground sm:px-4"
        >
          Updating history storage…
        </p>
      ) : null}
      {cache.snapshot.synchronization === "syncing" ? (
        <p
          role="status"
          className="px-3 py-3 text-meta text-muted-foreground sm:px-4"
        >
          Synchronizing history · {cache.snapshot.commitCount.toLocaleString()}{" "}
          commits stored
        </p>
      ) : null}
      {cache.error === undefined ? null : (
        <div
          role="alert"
          className="px-3 py-3 text-meta text-destructive sm:px-4"
        >
          {cache.error}
          <Button
            size="sm"
            variant="ghost"
            disabled={cache.pending}
            onClick={() => void cache.refresh()}
          >
            Retry
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirming !== undefined}
        title={`${confirming?.label ?? "Manage cache"}?`}
        description={confirming?.description ?? ""}
        action={confirming?.label ?? "Confirm"}
        onConfirm={() => {
          if (cache.confirmation !== undefined)
            void cache.manage(cache.confirmation);
        }}
        onClose={() => cache.setConfirmation(undefined)}
      />
    </>
  );
}
