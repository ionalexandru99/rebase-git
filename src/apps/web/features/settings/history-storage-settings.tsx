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
} from "#web/components/ui/alert-dialog";
import { Button } from "#web/components/ui/button";
import type { RepositoryHistoryStorageDiagnostics } from "#web/domain/repository-history/history-storage.contract";
import { RepositoryHistoryCacheList } from "#web/features/history-storage/components/repository-history-cache-list";
import { requestBrowserHistoryStorage } from "#web/features/repository-history/storage/browser-history-storage";
import { forgetAllRepositoryRefs } from "#web/features/repository-refs/repository-refs-query";

export function HistoryStorageSettings() {
  const [diagnostics, setDiagnostics] =
    useState<RepositoryHistoryStorageDiagnostics>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string>();
  const operation = useRef<AbortController | undefined>(undefined);
  const queryClient = useQueryClient();
  const run = useCallback(
    async (action: "inspect" | "clear") => {
      operation.current?.abort();
      const current = new AbortController();
      operation.current = current;
      setPending(true);
      setError(undefined);
      setMessage(undefined);
      try {
        setDiagnostics(
          await requestBrowserHistoryStorage(action, current.signal),
        );
        if (action === "clear") {
          forgetAllRepositoryRefs(queryClient);
          setMessage(
            "All history caches cleared. Rebuild or reopen a repository to load history.",
          );
        }
      } catch {
        if (current.signal.aborted) return;
        setError("History storage could not be updated. Try again.");
      }
      setPending(false);
    },
    [queryClient],
  );
  useEffect(() => {
    void run("inspect");
    return () => operation.current?.abort();
  }, [run]);
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-10 pb-16 sm:px-8 sm:pt-12">
      <h1 className="text-xl font-semibold tracking-tight">History storage</h1>
      <div className="mt-8 space-y-4" aria-busy={pending}>
        {diagnostics === undefined ? null : (
          <RepositoryHistoryCacheList diagnostics={diagnostics} />
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
        {message === undefined ? null : (
          <p role="status" className="text-sm text-muted-foreground">
            {message}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="destructive"
            disabled={
              pending ||
              diagnostics === undefined ||
              diagnostics.caches.length === 0
            }
            onClick={() => setConfirming(true)}
          >
            Clear all caches
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void run("inspect")}
          >
            Refresh
          </Button>
        </div>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogTitle>Clear all caches?</AlertDialogTitle>
          <AlertDialogDescription>
            Clear cached history for every repository in this client, including
            open repositories. Git files stay on disk. Rebuild or reopen
            repositories to load history.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void run("clear")}>
              Clear all caches
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
