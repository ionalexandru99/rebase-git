import type { RepositoryHistoryCacheProps } from "#web/features/repository-history/diagnostics/history-cache.contract";
import { historyCacheActions } from "#web/features/repository-history/diagnostics/history-cache-actions";
import { useHistoryCacheManagement } from "#web/features/repository-history/diagnostics/hooks/use-history-cache-management";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "#web-ui/components/ui/alert-dialog";
import { Button } from "#web-ui/components/ui/button";
import { SettingsRow } from "#web-ui/features/settings/components/settings-layout";

export function RepositoryCacheSettings(
  props: Pick<
    RepositoryHistoryCacheProps,
    "reader" | "identity" | "onCacheChanged"
  > & { readonly connected: boolean },
) {
  const cache = useHistoryCacheManagement(props);
  const current = cache.diagnostics?.caches.find(
    ({ environmentId, repositoryId }) =>
      environmentId === props.identity.environmentId &&
      repositoryId === props.identity.repositoryId,
  );
  const unavailable = cache.removed || cache.pending;
  return (
    <>
      <SettingsRow title="Cached history" description="Stored in this client.">
        <span className="text-sm text-muted-foreground">
          {current === undefined
            ? cache.diagnostics === undefined
              ? "Reading storage…"
              : "No cached history"
            : `${formatBytes(current.estimatedBytes)} · ${current.commitCount.toLocaleString()} commits`}
        </span>
      </SettingsRow>
      <SettingsRow
        title="Repair or clear history"
        description="Repository files stay on disk."
      >
        <Button
          size="sm"
          variant="outline"
          aria-label="Rebuild cache"
          disabled={unavailable || !props.connected}
          onClick={() => cache.setConfirmation("rebuild")}
        >
          Rebuild
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={unavailable}
          onClick={() => cache.setConfirmation("clear")}
        >
          Clear cache
        </Button>
      </SettingsRow>
      {cache.exhausted || cache.storageUnavailable ? (
        <p role="alert" className="text-sm text-destructive">
          {cache.exhausted
            ? "Browser storage is full."
            : "Browser storage is unavailable."}{" "}
          Clear unused history, then rebuild this cache.
        </p>
      ) : null}
      {cache.snapshot.error !== undefined &&
      !cache.storageUnavailable &&
      !cache.removed ? (
        <p role="alert" className="text-sm text-destructive">
          {cache.snapshot.error._tag === "RepositoryHistoryOffline"
            ? "Reconnect to finish history synchronization."
            : "History synchronization failed. Rebuild the cache to retry."}
        </p>
      ) : null}
      {cache.pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Updating history storage…
        </p>
      ) : null}
      {cache.snapshot.synchronization === "syncing" && !cache.removed ? (
        <p role="status" className="text-sm text-muted-foreground">
          Synchronizing history ·{" "}
          {(cache.snapshot.synchronizedCommitCount ?? 0).toLocaleString()}{" "}
          commits stored
        </p>
      ) : null}
      {cache.message === undefined ? null : (
        <p role="status" className="text-sm text-muted-foreground">
          {cache.message}
        </p>
      )}
      {cache.error === undefined ? null : (
        <div role="alert" className="text-sm text-destructive">
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
      <details className="px-4 text-sm text-muted-foreground">
        <summary className="cursor-pointer py-2">Storage details</summary>
        <div className="space-y-3 py-3">
          <p>
            Cache sizes are estimates. Open repositories are protected from
            automatic eviction.
          </p>
          {current === undefined ? null : <p>History: {current.state}</p>}
          <Button
            size="sm"
            variant="outline"
            disabled={unavailable}
            onClick={() => cache.setConfirmation("remove")}
          >
            Remove cache
          </Button>
        </div>
      </details>
      <AlertDialog
        open={cache.confirmation !== undefined}
        onOpenChange={(open) => {
          if (!open) cache.setConfirmation(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {cache.confirmation === undefined
              ? "Manage cache"
              : historyCacheActions[cache.confirmation].label}
            ?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {cache.confirmation === undefined
              ? ""
              : historyCacheActions[cache.confirmation].description}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (cache.confirmation !== undefined)
                  void cache.manage(cache.confirmation);
              }}
            >
              {cache.confirmation === undefined
                ? "Confirm"
                : historyCacheActions[cache.confirmation].label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
