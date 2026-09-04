import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { RepositoryHistoryCacheDialogProps } from "#web/features/repository-history/diagnostics/repository-history-cache-dialog.contract";
import type {
  RepositoryHistoryCacheAction,
  RepositoryHistoryStorageDiagnostics,
} from "#web/features/repository-history/repository-history-storage.contract";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "#web-ui/components/ui/dialog";
import { RepositoryHistoryCacheList } from "#web-ui/features/repository-history/diagnostics/repository-history-cache-list";

const actions: Record<
  RepositoryHistoryCacheAction,
  { label: string; description: string; result: string }
> = {
  clear: {
    label: "Clear cache",
    description:
      "Clear this repository’s cached history and pause synchronization. Rebuild when you want to download it again.",
    result: "Cache cleared. Synchronization is paused until you rebuild.",
  },
  rebuild: {
    label: "Rebuild cache",
    description:
      "Clear this repository’s cached history and download it again. The environment must be connected.",
    result: "Cache rebuild requested.",
  },
  remove: {
    label: "Remove cache",
    description:
      "Remove this repository’s cached history and close its history readers. Reopen the repository to download history again.",
    result: "Cache removed. Reopen the repository to load history.",
  },
  "clear-all": {
    label: "Clear all caches",
    description:
      "Clear cached history for every repository, including open repositories. Synchronization stays paused until each cache is rebuilt.",
    result: "All history caches cleared. Rebuild to resume synchronization.",
  },
};

export function RepositoryHistoryCacheButton(
  props: Omit<RepositoryHistoryCacheDialogProps, "open" | "onOpenChange">,
) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        History storage
      </Button>
      <RepositoryHistoryCacheDialog
        {...props}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

export function RepositoryHistoryCacheDialog(
  props: RepositoryHistoryCacheDialogProps,
) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open && (
        <CacheDialogBody
          key={`${props.identity.environmentId}/${props.identity.repositoryId}`}
          {...props}
        />
      )}
    </Dialog>
  );
}

function CacheDialogBody({
  reader,
  identity,
  repositoryName,
  onCacheChanged,
}: RepositoryHistoryCacheDialogProps) {
  const snapshot = useSyncExternalStore(reader.subscribe, reader.getSnapshot);
  const [diagnostics, setDiagnostics] =
    useState<RepositoryHistoryStorageDiagnostics>();
  const [confirmation, setConfirmation] =
    useState<RepositoryHistoryCacheAction>();
  const [pending, setPending] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const refresh = useCallback(async () => {
    setError(undefined);
    try {
      setDiagnostics(await reader.getCacheDiagnostics());
    } catch {
      setError("Unable to read history storage. Try refreshing.");
    }
  }, [reader]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function manage(action: RepositoryHistoryCacheAction) {
    setConfirmation(undefined);
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await reader.manageCache(action);
      if (action === "remove") {
        setRemoved(true);
        setDiagnostics(
          (value) =>
            value && {
              ...value,
              caches: value.caches.filter(
                (cache) =>
                  cache.environmentId !== identity.environmentId ||
                  cache.repositoryId !== identity.repositoryId,
              ),
            },
        );
      }
      await onCacheChanged(
        action,
        action === "clear-all" ? undefined : identity,
      );
      setMessage(actions[action].result);
      if (action !== "remove") await refresh();
    } catch {
      setError(
        "The cache action could not finish. Refresh storage details and try again.",
      );
    } finally {
      setPending(false);
    }
  }

  const exhausted =
    diagnostics?.usageBytes !== undefined &&
    diagnostics.quotaBytes !== undefined &&
    diagnostics.usageBytes >= diagnostics.quotaBytes;
  const storageUnavailable =
    snapshot.error?._tag === "RepositoryHistoryStorageUnavailable";
  return (
    <DialogContent className="max-w-2xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <DialogTitle className="text-base font-semibold">
            History storage
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-muted-foreground">
            Manage downloaded history for {repositoryName}. Git files are
            unaffected.
          </DialogDescription>
        </div>
        <DialogClose render={<Button size="sm" variant="ghost" />}>
          Close
        </DialogClose>
      </div>
      <div className="mt-5 space-y-4" aria-busy={pending}>
        {diagnostics ? (
          <RepositoryHistoryCacheList
            diagnostics={diagnostics}
            identity={identity}
            repositoryName={repositoryName}
          />
        ) : (
          !error && (
            <p role="status" className="text-sm">
              Reading storage…
            </p>
          )
        )}
        {(storageUnavailable || exhausted) && (
          <p role="alert" className="text-sm text-destructive">
            {exhausted
              ? "Browser storage is full."
              : "Browser storage is unavailable."}{" "}
            Clear unused history to free space, then rebuild this cache to retry
            synchronization.
          </p>
        )}
        {snapshot.error && !storageUnavailable && !removed && (
          <p role="alert" className="text-sm text-destructive">
            {snapshot.error._tag === "RepositoryHistoryOffline"
              ? "The environment is offline. Cached history remains available; reconnect to finish synchronization."
              : "History synchronization failed. Rebuild the cache to retry."}
          </p>
        )}
        {snapshot.synchronization === "syncing" && !removed && (
          <p role="status" className="text-sm">
            Synchronizing history ·{" "}
            {(snapshot.synchronizedCommitCount ?? 0).toLocaleString()} commits
            stored
          </p>
        )}
        {pending && (
          <p role="status" className="text-sm">
            Updating history storage…
          </p>
        )}
        {message && (
          <p role="status" className="text-sm">
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {(["clear", "rebuild", "remove", "clear-all"] as const).map(
            (action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "clear-all" ? "destructive" : "outline"}
                disabled={pending || removed}
                onClick={() => setConfirmation(action)}
              >
                {actions[action].label}
              </Button>
            ),
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || removed}
            onClick={() => void refresh()}
          >
            Refresh
          </Button>
        </div>
      </div>
      <AlertDialog
        open={confirmation !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirmation(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogTitle>
            {confirmation ? actions[confirmation].label : "Manage cache"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {confirmation && actions[confirmation].description}
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmation) void manage(confirmation);
              }}
            >
              {confirmation && actions[confirmation].label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DialogContent>
  );
}
