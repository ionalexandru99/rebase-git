import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "#web/components/ui/alert-dialog.tsx";
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
  const current = cache.diagnostics?.caches.find(
    ({ environmentId, repositoryId }) =>
      environmentId === props.identity.environmentId &&
      repositoryId === props.identity.repositoryId,
  );
  return (
    <>
      <SettingsRow title="Cached history" description="Stored in this client.">
        <span className="text-sm text-muted-foreground">
          {current === undefined
            ? cache.diagnostics === undefined
              ? "Reading storage…"
              : "No cached history"
            : `${formatCacheSize(current.estimatedBytes)} · ${current.commitCount.toLocaleString()} commits`}
        </span>
      </SettingsRow>
      <SettingsRow title="Repair or clear history">
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
        <p role="alert" className="text-sm text-destructive">
          {cache.exhausted
            ? "Browser storage is full."
            : "Browser storage is unavailable."}{" "}
          Clear unused history, then rebuild this cache.
        </p>
      ) : null}
      {cache.snapshot.failure !== undefined && !cache.storageUnavailable ? (
        <p role="alert" className="text-sm text-destructive">
          {cache.snapshot.failure._tag === "Offline"
            ? "Reconnect to finish history synchronization."
            : "History synchronization failed. Rebuild the cache to retry."}
        </p>
      ) : null}
      {cache.pending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Updating history storage…
        </p>
      ) : null}
      {cache.snapshot.synchronization === "syncing" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Synchronizing history · {cache.snapshot.commitCount.toLocaleString()}{" "}
          commits stored
        </p>
      ) : null}
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
