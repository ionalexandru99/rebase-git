import { lazy, Suspense, useSyncExternalStore } from "react";
import type { CommitInspectionController } from "#web/features/commit-inspection/commit-inspection-controller";
import { Button } from "#web-ui/components/ui/button";
import { CommitFiles } from "#web-ui/features/commit-inspection/components/commit-files";
import { CommitMetadata } from "#web-ui/features/commit-inspection/components/commit-metadata";

const CommitDiff = lazy(
  () => import("#web-ui/features/commit-inspection/components/commit-diff"),
);

export function CommitInspection({
  controller,
  connected,
}: {
  readonly controller: CommitInspectionController;
  readonly connected: boolean;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const details = state.details;
  return (
    <section
      aria-label="Commit details"
      aria-busy={state.loading}
      className="@container flex h-full min-h-0 flex-col"
    >
      {!connected ? (
        <p role="status" className="p-3 text-sm text-muted-foreground">
          Reconnect to the environment to inspect commits.
        </p>
      ) : null}
      {state.error ? (
        <div role="alert" className="p-3 text-sm">
          {state.error}{" "}
          <Button size="xs" variant="ghost" onClick={controller.retry}>
            Retry
          </Button>
        </div>
      ) : null}
      {details ? (
        <>
          <CommitMetadata key={details.oid} details={details} />
          {details.truncated ? (
            <p role="status" className="p-3 text-xs text-muted-foreground">
              The changed-file list is too large to show in full.
            </p>
          ) : null}
          {state.error ? null : state.loading ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              Loading changed files…
            </p>
          ) : details.files.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No file changes.
            </p>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(7rem,30%)] @[28rem]:grid-cols-[minmax(0,1fr)_12.5rem] @[28rem]:grid-rows-1">
              <Suspense
                fallback={
                  <p className="p-4 text-sm text-muted-foreground">
                    Loading diff viewer…
                  </p>
                }
              >
                <CommitDiff
                  key={`${details.oid}:${details.parentOid}`}
                  state={state}
                  controller={controller}
                />
              </Suspense>
              <CommitFiles
                files={details.files}
                path={state.path}
                select={controller.selectFile}
              />
            </div>
          )}
        </>
      ) : !state.error ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          {state.loading ? "Loading commit…" : "Select a commit in the graph."}
        </p>
      ) : null}
    </section>
  );
}
