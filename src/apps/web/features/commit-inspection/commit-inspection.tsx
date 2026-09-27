import { skipToken } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import {
  type CommitInspection as CommitDetails,
  CommitInspectionApi,
  type InspectCommit,
  type InspectCommitDiff,
} from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { CommitFiles } from "#web/features/commit-inspection/components/commit-files.tsx";
import { CommitMetadata } from "#web/features/commit-inspection/components/commit-metadata.tsx";
import { DiffWorkerPool } from "#web/features/file-diff/components/diff-worker-pool.tsx";
import { useDiffPreferences } from "#web/features/file-diff/hooks/use-diff-preferences.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";

const CommitDiff = lazy(
  () => import("#web/features/commit-inspection/components/commit-diff.tsx"),
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
  const error = inspection.isError ? describeFailure(inspection.error) : null;
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
                    error: diff.isError ? describeFailure(diff.error) : null,
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

export function CommitInspectionPanel() {
  const feature = usePanelFeature();
  const scope = feature?.scope;
  const environment = feature?.environment;
  if (scope === undefined || environment === undefined) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Connect to the environment to inspect commits.
      </p>
    );
  }
  return (
    <DiffWorkerPool>
      <CommitInspection
        scope={{
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
        }}
        connected={environment.connected}
      />
    </DiffWorkerPool>
  );
}

function useCommitDiff(
  scope: InspectionScope,
  details: CommitDetails | undefined,
  path: string | null,
  enabled: boolean,
) {
  return useEnvironmentQuery(
    CommitInspectionApi.inspectDiff,
    details === undefined || path === null
      ? skipToken
      : commitDiffInput(scope, details, path),
    { enabled, changes: "none" },
  );
}

function commitDiffInput(
  { repositoryId, worktreePath }: InspectionScope,
  details: CommitDetails,
  path: string,
): InspectCommitDiff {
  const previousPath = details.files.find(
    (file) => file.path === path,
  )?.previousPath;
  return {
    repositoryId,
    worktreePath,
    oid: details.oid,
    ...(details.parentOid === null ? {} : { parentOid: details.parentOid }),
    path,
    ...(previousPath == null ? {} : { previousPath }),
  };
}

type InspectionScope = Pick<InspectCommit, "repositoryId" | "worktreePath">;

function useCommitInspection(
  { repositoryId, worktreePath }: InspectionScope,
  oid: string | undefined,
  enabled: boolean,
) {
  return useEnvironmentQuery(
    CommitInspectionApi.inspect,
    oid === undefined ? skipToken : { repositoryId, worktreePath, oid },
    { enabled, changes: "none" },
  );
}
