import { IconCode, IconX } from "@tabler/icons-react";
import { skipToken } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import {
  type CommitInspection as CommitDetails,
  CommitInspectionApi,
  type InspectCommit,
  type InspectCommitDiff,
} from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import {
  type CodeMatchTarget,
  type CommitFocus,
  commitInputOid,
  isCommitInput,
} from "#web/features/commit-inspection/commit-input.ts";
import { CommitFiles } from "#web/features/commit-inspection/components/commit-files.tsx";
import { CommitMetadata } from "#web/features/commit-inspection/components/commit-metadata.tsx";
import {
  RestoreConfirmation,
  type RestorePreview,
  useRestoreFiles,
} from "#web/features/commit-inspection/restore-files.tsx";
import { useBlameAction } from "#web/features/file-blame/file-blame.ts";
import { DiffWorkerPool } from "#web/features/file-diff/components/diff-worker-pool.tsx";
import { useDiffPreferences } from "#web/features/file-diff/hooks/use-diff-preferences.ts";
import { useFileHistoryAction } from "#web/features/file-history/file-history.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import { describeFailure } from "#web/platform/query/request-failure.ts";

const CommitDiff = lazy(
  () => import("#web/features/commit-inspection/components/commit-diff.tsx"),
);

interface SelectedFile {
  readonly oid: string;
  readonly path: string;
  readonly focus: CommitFocus | undefined;
}

export function CommitInspection({
  scope,
  connected,
  writable,
}: {
  readonly scope: InspectionScope;
  readonly connected: boolean;
  readonly writable: boolean;
}) {
  const feature = usePanelFeature();
  const active = connected && feature?.active !== false;
  const input = isCommitInput(feature?.input) ? feature.input : undefined;
  const oid = commitInputOid(input);
  const inspection = useCommitInspection(scope, oid, active);
  const [widened, setWidened] = useState<unknown>();
  const match =
    typeof input === "object" && "match" in input && widened !== input
      ? input.match
      : undefined;
  const focus =
    typeof input === "object" && "lines" in input ? input : undefined;
  const details = narrowToMatch(inspection.data, match);
  const [selected, setSelected] = useState<SelectedFile>();
  const path =
    details === undefined ? null : selectedPath(details, selected, focus);
  const restore = useRestoreFiles(scope, details, connected && writable);
  const fileHistory = useFileHistoryAction();
  const blame = useBlameAction();
  const preview = useRestorePreview(scope, details, restore.preview, active);
  const diff = useCommitDiff(scope, details, path, active);
  const shown = restore.preview === undefined ? diff : preview;
  const [preferences, choosePreferences] = useDiffPreferences();
  const error = inspection.isError ? describeFailure(inspection.error) : null;
  const retry = () => void inspection.refetch();
  const select = (next: string) => {
    if (details !== undefined)
      setSelected({ oid: details.oid, path: next, focus });
  };
  return (
    <section
      aria-label="Commit details"
      aria-busy={inspection.isLoading}
      className="flex h-full min-h-0 flex-col"
    >
      {!connected ? (
        <p role="status" className="p-3 text-body text-muted-foreground">
          Reconnect to inspect commits.
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="p-3 text-body">
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
            <p role="status" className="p-3 text-meta text-muted-foreground">
              The changed-file list is too large to show in full.
            </p>
          ) : null}
          {details.files.length === 0 ? (
            <p className="p-4 text-body text-muted-foreground">
              No file changes.
            </p>
          ) : (
            <CommitFiles
              files={details.files}
              path={path}
              lead={
                match === undefined ? undefined : (
                  <MatchFilter
                    text={match.text}
                    onClear={() => setWidened(input)}
                  />
                )
              }
              select={select}
              preferences={preferences}
              choosePreferences={choosePreferences}
              actionsFor={(paths, anchor) => [
                ...restore.actionsFor(paths, anchor),
                ...fileHistory(paths),
                ...blame(
                  paths.filter((path) =>
                    details.files.some(
                      (file) => file.path === path && file.status !== "D",
                    ),
                  ),
                  details.oid,
                ),
              ]}
              onMenuClose={restore.endPreview}
            >
              <Suspense
                fallback={
                  <p className="p-4 text-body text-muted-foreground">
                    Loading diff viewer…
                  </p>
                }
              >
                <CommitDiff
                  key={`${details.oid}:${details.parentOid}`}
                  file={details.files.find((file) => file.path === path)}
                  diff={{
                    value: shown.data,
                    loading: shown.isLoading,
                    error: shown.isError ? describeFailure(shown.error) : null,
                    retry: () => void shown.refetch(),
                  }}
                  preview={restore.preview !== undefined}
                  focus={
                    focus?.oid === details.oid && focus.path === path
                      ? focus.lines
                      : undefined
                  }
                  preferences={preferences}
                  choosePreferences={choosePreferences}
                />
              </Suspense>
            </CommitFiles>
          )}
        </>
      ) : !error ? (
        <p role="status" className="p-4 text-body text-muted-foreground">
          {inspection.isLoading
            ? "Loading commit…"
            : "Select a commit in the graph."}
        </p>
      ) : null}
      <RestoreConfirmation restore={restore} />
    </section>
  );
}

function narrowToMatch(
  details: CommitDetails | undefined,
  match: CodeMatchTarget | undefined,
) {
  if (details === undefined || match === undefined) return details;
  const files = details.files.filter((file) => match.paths.includes(file.path));
  return files.length === 0 ? details : { ...details, files };
}

function MatchFilter({
  text,
  onClear,
}: {
  readonly text: string;
  readonly onClear: () => void;
}) {
  return (
    <div className="mx-1 mt-1 flex h-7 shrink-0 items-center gap-1.5 rounded-control bg-primary/10 pr-0.5 pl-2 text-body">
      <IconCode aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 truncate">{text}</span>
      <Button
        aria-label="Show all files"
        className="shrink-0 text-muted-foreground"
        onClick={onClear}
        size="icon-xs"
        variant="ghost"
      >
        <IconX aria-hidden="true" />
      </Button>
    </div>
  );
}

function selectedPath(
  details: CommitDetails,
  selected: SelectedFile | undefined,
  focus: CommitFocus | undefined,
) {
  const has = (path: string) =>
    details.files.some((file) => file.path === path);
  if (
    selected?.oid === details.oid &&
    selected.focus === focus &&
    has(selected.path)
  )
    return selected.path;
  if (focus?.oid === details.oid && has(focus.path)) return focus.path;
  return details.files[0]?.path ?? null;
}

export function CommitInspectionPanel() {
  const feature = usePanelFeature();
  const scope = feature?.scope;
  const environment = feature?.environment;
  if (scope === undefined || environment === undefined) {
    return (
      <p className="p-4 text-body text-muted-foreground">
        Reconnect to inspect commits.
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
        writable={environment.writable}
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

function useRestorePreview(
  { repositoryId, worktreePath }: InspectionScope,
  details: CommitDetails | undefined,
  preview: RestorePreview | undefined,
  enabled: boolean,
) {
  return useEnvironmentQuery(
    CommitInspectionApi.previewRestore,
    details === undefined || preview === undefined
      ? skipToken
      : {
          repositoryId,
          worktreePath,
          oid: details.oid,
          ...(details.parentOid === null
            ? {}
            : { parentOid: details.parentOid }),
          ...preview,
        },
    { enabled, changes: "index" },
  );
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
