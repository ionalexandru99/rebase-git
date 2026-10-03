import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { SettingsPage } from "#web/components/ui/settings-layout.tsx";
import { HistoryStorageBreakdown } from "#web/features/history-storage/history-storage-breakdown.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import {
  forgetAllRepositoryRefs,
  forgetRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import type {
  HistoryQuery,
  HistoryStorage,
} from "#web/features/repository-history/history-worker-protocol.ts";
import { openRepositoryHistory } from "#web/features/repository-history/repository-history.ts";

type StorageQuery = Extract<HistoryQuery, { _tag: "Storage" | "ClearCache" }>;

const inspect: StorageQuery = { _tag: "Storage", action: "inspect" };
const clearAll: StorageQuery = { _tag: "Storage", action: "clear-all" };

export function HistoryStorageSettings() {
  const [storage, setStorage] = useState<HistoryStorage>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const queryClient = useQueryClient();
  const errorToast = useErrorToast();
  const run = useCallback(
    async (query: StorageQuery) => {
      operation.current?.abort();
      const current = new AbortController();
      operation.current = current;
      setPending(true);
      setError(undefined);
      try {
        setStorage(await askHistoryStorage(query, current.signal));
        if (query._tag === "ClearCache")
          forgetRepositoryRefs(
            queryClient,
            query.cache.environmentId,
            query.cache.repositoryId,
          );
        else if (query.action === "clear-all")
          forgetAllRepositoryRefs(queryClient);
      } catch {
        if (current.signal.aborted) return;
        if (query === inspect)
          setError("Unable to read history storage. Try again.");
        else
          errorToast.show(
            query._tag === "ClearCache" ? "clearHistory" : "clearAllHistory",
          );
      }
      setPending(false);
    },
    [queryClient, errorToast],
  );
  useEffect(() => {
    void run(inspect);
    return () => operation.current?.abort();
  }, [run]);
  return (
    <SettingsPage title="History storage">
      <div className="space-y-8" aria-busy={pending}>
        {storage === undefined ? null : (
          <HistoryStorageBreakdown
            storage={storage}
            pending={pending}
            onClear={({ environmentId, repositoryId }) =>
              void run({
                _tag: "ClearCache",
                cache: { environmentId, repositoryId },
              })
            }
            clearAll={
              <Button
                className="text-destructive"
                size="xs"
                variant="ghost"
                disabled={pending || storage.caches.length === 0}
                onClick={() => setConfirming(true)}
              >
                Clear all history
              </Button>
            }
          />
        )}
        {pending ? (
          <p role="status" className="text-sm text-muted-foreground">
            Updating history storage…
          </p>
        ) : null}
        {error === undefined ? null : (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>Clear all history?</AlertDialogTitle>
          <AlertDialogDescription>
            Repository files stay on disk. Reopen a repository to download its
            history again.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run(clearAll)}>
              Clear all history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsPage>
  );
}

async function askHistoryStorage(query: StorageQuery, signal: AbortSignal) {
  const storage = openRepositoryHistory();
  try {
    return await storage.ask(query, signal);
  } finally {
    storage.close();
  }
}
