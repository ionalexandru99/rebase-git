import { skipToken } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import {
  RepositoryStashesApi,
  type StashContents,
} from "#contracts/repository-stashes/repository-stashes.contract.ts";
import {
  CommitFiles,
  fileSteps,
} from "#web/features/commit-inspection/components/commit-files.tsx";
import { DiffWorkerPool } from "#web/features/file-diff/components/diff-worker-pool.tsx";
import { useDiffPreferences } from "#web/features/file-diff/hooks/use-diff-preferences.ts";
import { useFileHistoryAction } from "#web/features/file-history/file-history.ts";
import { isStashInput, useStashes } from "#web/features/stashes/stashes.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";
import { ageLabel, useNow } from "#web/lib/age-label.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";

const CommitDiff = lazy(
  () => import("#web/features/commit-inspection/components/commit-diff.tsx"),
);

export function StashPanel() {
  const now = useNow();
  const feature = usePanelFeature();
  const scope = feature?.scope;
  const oid = isStashInput(feature?.input) ? feature.input.oid : undefined;
  const stash = useStashes().find((candidate) => candidate.oid === oid);
  const enabled =
    feature?.active !== false && feature?.environment?.connected === true;
  const contents = useEnvironmentQuery(
    RepositoryStashesApi.contents,
    scope === undefined || oid === undefined || stash === undefined
      ? skipToken
      : {
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
          oid,
        },
    { changes: "none", enabled },
  );
  if (oid === undefined || stash === undefined)
    return (
      <p role="status" className="p-4 text-body text-muted-foreground">
        {oid === undefined
          ? "Select a stash in the sidebar."
          : "This stash no longer exists."}
      </p>
    );
  return (
    <section aria-label="Stash" className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-border border-b px-4 py-3 text-meta">
        <h2 className="break-words text-heading font-medium">{stash.name}</h2>
        <p className="mt-2 flex flex-wrap gap-x-3 text-muted-foreground">
          {stash.branch === null ? null : (
            <span className="font-mono text-badge">{stash.branch}</span>
          )}
          <span>{ageLabel(stash.recordedAt, now)}</span>
        </p>
      </header>
      {contents.isError ? (
        <p role="alert" className="p-3 text-body">
          {describeFailure(contents.error)}
        </p>
      ) : contents.data === undefined ? (
        <p role="status" className="p-4 text-body text-muted-foreground">
          Loading stash…
        </p>
      ) : (
        <DiffWorkerPool>
          {contents.data.truncated ? (
            <p role="status" className="p-3 text-meta text-muted-foreground">
              The changed-file list is too large to show in full.
            </p>
          ) : null}
          <StashFiles key={oid} contents={contents.data} oid={oid} />
        </DiffWorkerPool>
      )}
    </section>
  );
}

function StashFiles({
  contents,
  oid,
}: {
  readonly contents: StashContents;
  readonly oid: string;
}) {
  const scope = usePanelFeature()?.scope;
  const [selected, setSelected] = useState(contents.files[0]?.path ?? null);
  const fileHistory = useFileHistoryAction();
  const [preferences, choosePreferences] = useDiffPreferences();
  const file = contents.files.find((candidate) => candidate.path === selected);
  const diff = useEnvironmentQuery(
    CommitInspectionApi.inspectDiff,
    scope === undefined || file === undefined
      ? skipToken
      : {
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
          path: file.path,
          ...(file.untracked && contents.untracked !== null
            ? { oid: contents.untracked }
            : { oid, parentOid: contents.base }),
          ...(file.previousPath === null
            ? {}
            : { previousPath: file.previousPath }),
        },
    { changes: "none" },
  );
  if (contents.files.length === 0)
    return (
      <p className="p-4 text-body text-muted-foreground">No file changes.</p>
    );
  return (
    <CommitFiles
      files={contents.files}
      path={selected}
      select={setSelected}
      actionsFor={fileHistory}
      preferences={preferences}
      choosePreferences={choosePreferences}
    >
      <Suspense
        fallback={
          <p className="p-4 text-body text-muted-foreground">
            Loading diff viewer…
          </p>
        }
      >
        <CommitDiff
          file={contents.files.find((file) => file.path === selected)}
          steps={fileSteps(contents.files, selected, setSelected)}
          diff={{
            value: diff.data,
            loading: diff.isLoading,
            error: diff.isError ? describeFailure(diff.error) : null,
            retry: () => void diff.refetch(),
          }}
          preview={false}
          preferences={preferences}
          choosePreferences={choosePreferences}
        />
      </Suspense>
    </CommitFiles>
  );
}
