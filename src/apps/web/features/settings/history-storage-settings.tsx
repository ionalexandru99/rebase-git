import { Effect, Fiber } from "effect";
import { useCallback, useEffect, useRef, useState } from "react";
import { manageBrowserHistoryStorage } from "#web/features/repository-history/diagnostics/browser-history-storage";
import type { RepositoryHistoryStorageDiagnostics } from "#web/features/repository-history/repository-history-storage.contract";
import { clearAllCachedRepositoryRefs } from "#web/features/repository-refs/browser-repository-refs-cache";
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
import { RepositoryHistoryCacheList } from "#web-ui/features/repository-history/diagnostics/components/repository-history-cache-list";

export function HistoryStorageSettings() {
  const [diagnostics, setDiagnostics] =
    useState<RepositoryHistoryStorageDiagnostics>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string>();
  const operation = useRef<Fiber.Fiber<void> | undefined>(undefined);
  const run = useCallback((action: "inspect" | "clear") => {
    if (operation.current !== undefined)
      Effect.runFork(Fiber.interrupt(operation.current));
    setPending(true);
    setError(undefined);
    setMessage(undefined);
    operation.current = Effect.runFork(
      manageBrowserHistoryStorage(action).pipe(
        Effect.tap((result) => Effect.sync(() => setDiagnostics(result))),
        Effect.tap(() =>
          action === "clear"
            ? Effect.tryPromise(() => clearAllCachedRepositoryRefs()).pipe(
                Effect.tap(() =>
                  Effect.sync(() =>
                    setMessage(
                      "All history caches cleared. Rebuild or reopen a repository to load history.",
                    ),
                  ),
                ),
              )
            : Effect.void,
        ),
        Effect.catch(() =>
          Effect.sync(() =>
            setError("History storage could not be updated. Try again."),
          ),
        ),
        Effect.tap(() => Effect.sync(() => setPending(false))),
        Effect.asVoid,
      ),
    );
  }, []);
  useEffect(() => {
    run("inspect");
    return () => {
      if (operation.current !== undefined)
        Effect.runFork(Fiber.interrupt(operation.current));
    };
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
            onClick={() => run("inspect")}
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
            <AlertDialogAction onClick={() => run("clear")}>
              Clear all caches
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
