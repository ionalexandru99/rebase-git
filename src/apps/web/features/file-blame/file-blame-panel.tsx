import { FileBlameApi } from "#contracts/file-blame/file-blame.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { CommitRefPill } from "#web/features/commit-graph/components/commit-ref-labels.tsx";
import {
  type BlameHandlers,
  BlameLines,
} from "#web/features/file-blame/blame-lines.tsx";
import {
  type BlameInput,
  isBlameInput,
} from "#web/features/file-blame/file-blame.ts";
import { DiffWorkerPool } from "#web/features/file-diff/components/diff-worker-pool.tsx";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import { usePanelFeature } from "#web/features/workspace-panel/api.ts";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import {
  type RepositoryScope,
  useRepositoryScope,
} from "#web/platform/query/repository-scope.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";

export function FileBlamePanel(handlers: BlameHandlers) {
  const feature = usePanelFeature();
  const scope = useRepositoryScope();
  const input = isBlameInput(feature?.input) ? feature.input : null;
  if (input === null || scope === undefined) return null;
  return (
    <DiffWorkerPool>
      <FileBlame
        key={`${input.revision}:${input.path}`}
        scope={scope}
        input={input}
        {...handlers}
      />
    </DiffWorkerPool>
  );
}

function FileBlame({
  scope,
  input,
  ...handlers
}: BlameHandlers & {
  readonly scope: RepositoryScope;
  readonly input: BlameInput;
}) {
  const feature = usePanelFeature();
  const { refs } = useScopedRepositoryRefs();
  const head =
    refs === undefined ? undefined : activeHead(refs, scope.worktreePath);
  const blame = useEnvironmentQuery(
    FileBlameApi.read,
    {
      repositoryId: scope.repositoryId,
      worktreePath: scope.worktreePath,
      path: input.path,
      revision: input.revision,
    },
    {
      changes: input.revision === null ? "index" : "none",
      enabled: feature?.active !== false,
      keepPrevious: true,
    },
  );
  const folder = input.path.slice(0, Math.max(0, input.path.lastIndexOf("/")));
  const revision =
    input.revision === null
      ? head === undefined
        ? undefined
        : head.branch === undefined
          ? { name: head.commit.slice(0, 8), type: "commit" as const }
          : { name: head.branch, type: "branch" as const }
      : { name: input.revision.slice(0, 8), type: "commit" as const };
  return (
    <section aria-label="Blame" className="flex h-full min-h-0 flex-col">
      <header className="flex h-9 shrink-0 items-center gap-2 border-border border-b px-3">
        <span className="min-w-0 flex-1 truncate text-left text-meta text-muted-foreground [direction:rtl]">
          <bdi>{folder}</bdi>
        </span>
        {revision === undefined ? null : <CommitRefPill label={revision} />}
      </header>
      {blame.isError ? (
        <div role="alert" className="p-3 text-body">
          {describeFailure(blame.error)}{" "}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void blame.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : blame.data === undefined ? (
        <p role="status" className="p-4 text-body text-muted-foreground">
          Loading blame…
        </p>
      ) : blame.data._tag === "Unblamable" ? (
        <p className="p-4 text-body text-muted-foreground">
          {blame.data.reason === "binary"
            ? "Binary file"
            : "This file is too large to blame."}
        </p>
      ) : (
        <BlameLines
          path={input.path}
          text={blame.data.text}
          line={input.line}
          ranges={blame.data.ranges}
          commits={blame.data.commits}
          {...handlers}
        />
      )}
    </section>
  );
}
