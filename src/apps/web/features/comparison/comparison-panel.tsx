import { IconArrowsLeftRight } from "@tabler/icons-react";
import { skipToken } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import {
  CompareApi,
  type Comparison,
  type ComparisonSide,
} from "#contracts/repository-comparison/compare-revisions.contract.ts";
import type { RepositoryRefs } from "#contracts/repository-refs/repository-refs.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { CommitFiles } from "#web/features/commit-inspection/components/commit-files.tsx";
import {
  type CompareInput,
  isCompareInput,
  sideName,
} from "#web/features/comparison/comparison.ts";
import {
  type CommitRun,
  ComparisonCommits,
} from "#web/features/comparison/comparison-commits.tsx";
import { RefPicker } from "#web/features/comparison/ref-picker.tsx";
import { DiffWorkerPool } from "#web/features/file-diff/components/diff-worker-pool.tsx";
import { useDiffPreferences } from "#web/features/file-diff/hooks/use-diff-preferences.ts";
import { useScopedRepositoryRefs } from "#web/features/refs/repository-refs.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import {
  type RepositoryScope,
  useRepositoryScope,
} from "#web/platform/query/repository-scope.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";

const CommitDiff = lazy(
  () => import("#web/features/commit-inspection/components/commit-diff.tsx"),
);

export function ComparisonPanel({
  history,
}: {
  readonly history?: Pick<RepositoryHistory, "ask"> | undefined;
}) {
  const feature = usePanelFeature();
  const scope = useRepositoryScope();
  const input = isCompareInput(feature?.input) ? feature.input : undefined;
  if (input === undefined || scope === undefined) return null;
  const change = (next: CompareInput) =>
    feature?.dispatch({
      type: "replace",
      kind: "compare",
      previous: input,
      input: next,
    });
  return (
    <DiffWorkerPool>
      <section aria-label="Comparison" className="flex h-full min-h-0 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-border border-b px-3 py-2 text-meta">
          <RefPicker
            label="Compare from"
            side={input.from}
            history={history}
            onPick={(from) => change({ ...input, from })}
          />
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Swap sides"
            onClick={() => change({ ...input, from: input.to, to: input.from })}
          >
            <IconArrowsLeftRight aria-hidden="true" />
          </Button>
          <RefPicker
            label="Compare to"
            side={input.to}
            history={history}
            onPick={(to) => change({ ...input, to })}
          />
        </header>
        <ComparisonBody
          scope={scope}
          input={input}
          active={feature?.active !== false}
        />
      </section>
    </DiffWorkerPool>
  );
}

function ComparisonBody({
  scope,
  input,
  active,
}: {
  readonly scope: RepositoryScope;
  readonly input: CompareInput;
  readonly active: boolean;
}) {
  const target = {
    repositoryId: scope.repositoryId,
    worktreePath: scope.worktreePath,
  };
  const comparison = useEnvironmentQuery(
    CompareApi.compare,
    { ...target, from: input.from, to: input.to },
    { changes: "none", enabled: active },
  );
  const { refs } = useScopedRepositoryRefs();
  if (comparison.isError)
    return (
      <div role="alert" className="p-3 text-body">
        {describeFailure(comparison.error)}{" "}
        <Button
          size="xs"
          variant="ghost"
          onClick={() => void comparison.refetch()}
        >
          Retry
        </Button>
      </div>
    );
  if (comparison.data === undefined)
    return (
      <p role="status" className="p-4 text-body text-muted-foreground">
        Loading comparison…
      </p>
    );
  const moved = movedSides(refs, input, comparison.data);
  return (
    <>
      {moved.length === 0 ? null : (
        <div
          role="status"
          className="flex shrink-0 items-center gap-2 border-border border-b bg-warning-surface px-3 py-1.5 text-warning text-meta"
        >
          <span className="min-w-0 flex-1 truncate">
            {moved.join(" and ")} moved
          </span>
          <Button
            size="xs"
            variant="outline"
            onClick={() => void comparison.refetch()}
          >
            Refresh
          </Button>
        </div>
      )}
      <ComparisonFiles
        key={`${comparison.data.from}:${comparison.data.to}`}
        target={target}
        whole={comparison.data}
        active={active}
      />
    </>
  );
}

function ComparisonFiles({
  target,
  whole,
  active,
}: {
  readonly target: Pick<RepositoryScope, "repositoryId" | "worktreePath">;
  readonly whole: Comparison;
  readonly active: boolean;
}) {
  const [run, setRun] = useState<CommitRun>();
  const oldest = run === undefined ? undefined : whole.commits[run.last];
  const newest = run === undefined ? undefined : whole.commits[run.first];
  const narrowed = useEnvironmentQuery(
    CompareApi.compare,
    oldest?.parentOid == null || newest === undefined
      ? skipToken
      : {
          ...target,
          from: { _tag: "Commit", oid: oldest.parentOid },
          to: { _tag: "Commit", oid: newest.oid },
        },
    { changes: "none", enabled: active, keepPrevious: true },
  );
  const shown = run === undefined ? whole : (narrowed.data ?? whole);
  const [selected, setSelected] = useState<string>();
  const path =
    shown.files.find((file) => file.path === selected)?.path ??
    shown.files[0]?.path ??
    null;
  const file = shown.files.find((entry) => entry.path === path);
  const diff = useEnvironmentQuery(
    CompareApi.diff,
    file === undefined
      ? skipToken
      : {
          ...target,
          oid: shown.to,
          ...(shown.base === null ? {} : { parentOid: shown.base }),
          path: file.path,
          ...(file.previousPath === null
            ? {}
            : { previousPath: file.previousPath }),
        },
    { changes: "none", enabled: active },
  );
  const [preferences, choosePreferences] = useDiffPreferences();
  return (
    <>
      {shown.truncated ? (
        <p role="status" className="p-3 text-meta text-muted-foreground">
          The changed-file list is too large to show in full.
        </p>
      ) : null}
      <CommitFiles
        files={shown.files}
        path={path}
        select={setSelected}
        preferences={preferences}
        choosePreferences={choosePreferences}
        lead={
          <ComparisonCommits
            commits={whole.commits}
            complete={whole.commitsComplete}
            run={run}
            onRun={setRun}
          />
        }
      >
        {file === undefined ? (
          <p className="p-4 text-body text-muted-foreground">No changes.</p>
        ) : (
          <Suspense
            fallback={
              <p className="p-4 text-body text-muted-foreground">
                Loading diff viewer…
              </p>
            }
          >
            <CommitDiff
              key={`${shown.base}:${shown.to}`}
              file={file}
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
        )}
      </CommitFiles>
    </>
  );
}

function movedSides(
  refs: RepositoryRefs | undefined,
  input: CompareInput,
  comparison: Comparison,
) {
  if (refs === undefined) return [];
  return [
    [input.from, comparison.from] as const,
    [input.to, comparison.to] as const,
  ].flatMap(([side, pinned]) => {
    const current = currentTarget(refs, side);
    return current === undefined || current === pinned ? [] : [sideName(side)];
  });
}

function currentTarget(refs: RepositoryRefs, side: ComparisonSide) {
  switch (side._tag) {
    case "LocalBranch":
      return refs.branches.find(({ name }) => name === side.name)?.target;
    case "RemoteBranch":
      return refs.remoteBranches.find(
        ({ name, remote }) => name === side.name && remote === side.remote,
      )?.target;
    case "Tag":
      return refs.tags.find(({ name }) => name === side.name)?.target;
    case "Commit":
      return undefined;
  }
}
