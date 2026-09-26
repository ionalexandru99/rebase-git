import type { CommitInspection as CommitDetails } from "@rebase/contracts";
import { lazy, Suspense, useState } from "react";
import { useCommitDiff } from "#web/features/commit-inspection/hooks/use-commit-diff";
import {
  type InspectionScope,
  useCommitInspection,
} from "#web/features/commit-inspection/hooks/use-commit-inspection";
import { describeInspectionFailure } from "#web/features/commit-inspection/inspection-messages";
import { useDiffPreferences } from "#web/features/file-diff/index";
import { usePanelFeature } from "#web/features/workspace-panel/api";
import { Button } from "#web-ui/components/ui/button";
import { CommitFiles } from "#web-ui/features/commit-inspection/components/commit-files";
import { CommitMetadata } from "#web-ui/features/commit-inspection/components/commit-metadata";

const CommitDiff = lazy(
  () => import("#web-ui/features/commit-inspection/components/commit-diff"),
);

interface SelectedFile {
  readonly oid: string;
  readonly path: string;
}

export function CommitInspection({
  scope,
  connected,
}: {
  readonly scope: InspectionScope;
  readonly connected: boolean;
}) {
  const feature = usePanelFeature();
  const active = connected && feature?.active !== false;
  const oid = typeof feature?.input === "string" ? feature.input : undefined;
  const inspection = useCommitInspection(scope, oid, active);
  const details = inspection.data;
  const [selected, setSelected] = useState<SelectedFile>();
  const path = details === undefined ? null : selectedPath(details, selected);
  const diff = useCommitDiff(scope, details, path, active);
  const [preferences, choosePreferences] = useDiffPreferences();
  const error = inspection.isError
    ? describeInspectionFailure(inspection.error)
    : null;
  const retry = () => void inspection.refetch();
  const select = (next: string) => {
    if (details !== undefined) setSelected({ oid: details.oid, path: next });
  };
  return (
    <section
      aria-label="Commit details"
      aria-busy={inspection.isLoading}
      className="@container flex h-full min-h-0 flex-col"
    >
      {!connected ? (
        <p role="status" className="p-3 text-sm text-muted-foreground">
          Reconnect to the environment to inspect commits.
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="p-3 text-sm">
          {error}{" "}
          <Button size="xs" variant="ghost" onClick={retry}>
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
          {details.files.length === 0 ? (
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
                  files={details.files}
                  path={path}
                  select={select}
                  diff={{
                    value: diff.data,
                    loading: diff.isLoading,
                    error: diff.isError
                      ? describeInspectionFailure(diff.error)
                      : null,
                    retry: () => void diff.refetch(),
                  }}
                  preferences={preferences}
                  choosePreferences={choosePreferences}
                />
              </Suspense>
              <CommitFiles files={details.files} path={path} select={select} />
            </div>
          )}
        </>
      ) : !error ? (
        <p role="status" className="p-4 text-sm text-muted-foreground">
          {inspection.isLoading
            ? "Loading commit…"
            : "Select a commit in the graph."}
        </p>
      ) : null}
    </section>
  );
}

function selectedPath(
  details: CommitDetails,
  selected: SelectedFile | undefined,
) {
  if (
    selected?.oid === details.oid &&
    details.files.some((file) => file.path === selected.path)
  )
    return selected.path;
  return details.files[0]?.path ?? null;
}
