import { Toast } from "@base-ui/react/toast";
import { IconChevronRight } from "@tabler/icons-react";
import { skipToken } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { CommitInspectionApi } from "#contracts/commit-inspection/commit-inspection.contract.ts";
import { RepositoryChangesApi } from "#contracts/repository-changes/repository-changes.contract.ts";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import {
  type CherryPickResult,
  type RepositoryOperation,
  RepositoryOperationsApi,
} from "#contracts/repository-operations/repository-operations.contract.ts";
import type { RepositoryHead } from "#contracts/repository-refs/repository-refs.contract.ts";
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubmenu,
  ContextMenuSubmenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation.ts";
import { operationKindLabel } from "#web/features/operation-recovery/operation-messages.ts";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import type { HistoryScopeQuery } from "#web/features/repository-history/history-view.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import {
  type RepositoryScope,
  useRepositoryScope,
} from "#web/platform/query/repository-scope.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

interface CherryPickPlan {
  readonly commits: readonly RepositoryCommit[];
  readonly merge: RepositoryCommit | undefined;
  readonly merges: number;
  readonly parents: readonly RepositoryCommit[];
}

type Run = (result: CherryPickResult, mainline: number | null) => void;

const itemClassName = "text-[.85rem] sm:text-[.85rem]";

export type CherryPick = ReturnType<typeof useCherryPick>;

export function useCherryPick(
  history: Pick<RepositoryHistory, "ask"> | undefined,
) {
  const repository = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  const operation = useOperation(repository, false).data;
  const panel = useWorkspacePanel();
  const notifications = Toast.useToastManager();
  const head =
    refs === undefined || repository === undefined
      ? undefined
      : activeHead(refs, repository.worktreePath);
  const [plan, setPlan] = useState<CherryPickPlan>();
  const request = useRef(0);
  const start = useCommand(RepositoryOperationsApi.start, {
    answers: (value, { repositoryId, worktreePath }) => [
      answer(
        RepositoryOperationsApi.read,
        { repositoryId, worktreePath },
        value.operation,
      ),
    ],
  });
  const changes = useEnvironmentQuery(
    RepositoryChangesApi.read,
    repository === undefined || plan === undefined
      ? skipToken
      : {
          repositoryId: repository.repositoryId,
          worktreePath: repository.worktreePath,
          amend: false,
        },
    { changes: "index" },
  );

  const open = (
    oids: readonly string[],
    scope: HistoryScopeQuery | undefined,
  ) => {
    const current = ++request.current;
    setPlan(undefined);
    if (history === undefined || scope === undefined) return;
    void resolvePlan(history, scope, oids).then(
      (resolved) => {
        if (current === request.current) setPlan(resolved);
      },
      () => undefined,
    );
  };

  const run: Run = (result, mainline) => {
    if (plan === undefined || head === undefined) return;
    void start
      .run({
        expectedHead: head.commit,
        operation: {
          _tag: "CherryPick",
          commits: plan.commits.map(({ oid }) => oid),
          mainline,
          result,
        },
      })
      .then((outcome) => {
        if (outcome._tag === "Ok") {
          if (outcome.value.outcome === "Staged")
            panel.execute({ type: "open", kind: "changes" });
          return;
        }
        if (outcome._tag !== "Cancelled")
          notifications.add({ title: describeFailure(outcome) });
      });
  };

  const menu =
    plan === undefined ||
    head === undefined ||
    repository === undefined ? undefined : (
      <CherryPickItems
        plan={plan}
        head={head}
        repository={repository}
        blocked={blockedReason(repository, {
          canRun: start.canRun,
          running: start.running,
          operation,
          plan,
        })}
        staged={(changes.data?.staged.length ?? 0) > 0}
        run={run}
      />
    );
  return { open, menu };
}

async function resolvePlan(
  history: Pick<RepositoryHistory, "ask">,
  scope: HistoryScopeQuery,
  oids: readonly string[],
): Promise<CherryPickPlan> {
  const [rows, found] = await Promise.all([
    history.ask({ _tag: "Locate", scope, oids }),
    history.ask({ _tag: "Commits", oids }),
  ]);
  const row = new Map(oids.map((oid, index) => [oid, rows[index]]));
  if (
    found.length !== oids.length ||
    found.some((commit) => row.get(commit.oid) === undefined)
  )
    throw new Error("A selected commit is not in the loaded history.");
  const commits = [...found].sort(
    (left, right) => (row.get(right.oid) ?? 0) - (row.get(left.oid) ?? 0),
  );
  const merges = commits.filter((commit) => commit.parents.length > 1);
  const merge = merges.length === 1 ? merges[0] : undefined;
  const parents =
    merge === undefined
      ? []
      : await history.ask({ _tag: "Commits", oids: merge.parents });
  return { commits, merge, merges: merges.length, parents };
}

function blockedReason(
  repository: RepositoryScope,
  {
    canRun,
    running,
    operation,
    plan,
  }: {
    readonly canRun: boolean;
    readonly running: boolean;
    readonly operation: RepositoryOperation | undefined;
    readonly plan: CherryPickPlan;
  },
) {
  if (!repository.writable) return "Read only";
  if (!canRun || !repository.connected) return "Offline";
  if (operation !== undefined && operation.kind !== "idle")
    return `${operationKindLabel(operation.kind)} in progress`;
  if (running) return "Cherry-picking…";
  if (plan.merges > 1) return "Several merges";
  return undefined;
}

function CherryPickItems({
  plan,
  head,
  repository,
  blocked,
  staged,
  run,
}: {
  readonly plan: CherryPickPlan;
  readonly head: RepositoryHead;
  readonly repository: RepositoryScope;
  readonly blocked: string | undefined;
  readonly staged: boolean;
  readonly run: Run;
}) {
  const count = plan.commits.length;
  const noun = count === 1 ? "commit" : `${count} commits`;
  return (
    <>
      <p className="flex items-center gap-1.5 px-2 pt-1.5 pb-1 text-[.7rem] text-muted-foreground">
        Onto
        <span className="font-medium text-foreground">
          {head.branch ?? "HEAD"}
        </span>
        <span className="font-mono">{head.commit.slice(0, 7)}</span>
      </p>
      <ol
        aria-label="Cherry-pick order"
        className="max-h-64 overflow-y-auto px-1 pb-1"
      >
        {plan.commits.map((commit, index) => (
          <li
            key={commit.oid}
            className="flex h-6 min-w-0 items-center gap-2 px-1 text-[.75rem]"
          >
            <span className="w-4 shrink-0 text-right font-mono text-muted-foreground">
              {index + 1}
            </span>
            <span className="shrink-0 font-mono text-muted-foreground">
              {commit.oid.slice(0, 7)}
            </span>
            <span className="truncate">{commit.subject}</span>
          </li>
        ))}
      </ol>
      <ContextMenuSeparator />
      <ResultItem
        label={`Cherry-pick ${noun}`}
        reason={blocked}
        plan={plan}
        repository={repository}
        run={(mainline) => run("commit", mainline)}
      />
      <ResultItem
        label={`Stage ${noun} without committing`}
        reason={blocked ?? (staged ? "Staged changes" : undefined)}
        plan={plan}
        repository={repository}
        run={(mainline) => run("stage", mainline)}
      />
      <ContextMenuSeparator />
    </>
  );
}

function ResultItem({
  label,
  reason,
  plan,
  repository,
  run,
}: {
  readonly label: string;
  readonly reason: string | undefined;
  readonly plan: CherryPickPlan;
  readonly repository: RepositoryScope;
  readonly run: (mainline: number | null) => void;
}) {
  const { merge } = plan;
  if (merge === undefined || reason !== undefined)
    return (
      <ContextMenuItem
        className={itemClassName}
        disabled={reason !== undefined}
        onClick={() => run(null)}
      >
        <span className="flex-1">{label}</span>
        {reason === undefined ? null : (
          <span className="text-[.7rem] text-muted-foreground">{reason}</span>
        )}
      </ContextMenuItem>
    );
  return (
    <ContextMenuSubmenu>
      <ContextMenuSubmenuTrigger className={itemClassName}>
        <span className="flex-1">{label}</span>
        <IconChevronRight
          aria-hidden="true"
          className="size-3.5 text-muted-foreground"
        />
      </ContextMenuSubmenuTrigger>
      <ContextMenuContent submenu className="w-80">
        <p className="mb-1 truncate border-border border-b px-2 pt-1 pb-1.5 font-mono text-[.7rem] text-muted-foreground">
          Merge {merge.oid.slice(0, 7)} relative to
        </p>
        {merge.parents.map((parent, index) => (
          <ParentItem
            key={parent}
            merge={merge.oid}
            parent={parent}
            subject={plan.parents.find(({ oid }) => oid === parent)?.subject}
            repository={repository}
            onClick={() => run(index + 1)}
          />
        ))}
      </ContextMenuContent>
    </ContextMenuSubmenu>
  );
}

function ParentItem({
  merge,
  parent,
  subject,
  repository,
  onClick,
}: {
  readonly merge: string;
  readonly parent: string;
  readonly subject: string | undefined;
  readonly repository: RepositoryScope;
  readonly onClick: () => void;
}) {
  const inspection = useEnvironmentQuery(
    CommitInspectionApi.inspect,
    {
      repositoryId: repository.repositoryId,
      worktreePath: repository.worktreePath,
      oid: merge,
      parentOid: parent,
    },
    { changes: "none" },
  );
  const files = inspection.data?.files;
  return (
    <ContextMenuItem className={itemClassName} onClick={onClick}>
      <span className="shrink-0 font-mono text-[.75rem] text-muted-foreground">
        {parent.slice(0, 7)}
      </span>
      <span className="min-w-0 flex-1 truncate">{subject}</span>
      <span className="shrink-0 text-[.7rem] text-muted-foreground">
        {files === undefined
          ? ""
          : files.length === 1
            ? files[0]?.path.split("/").at(-1)
            : `${files.length} files`}
      </span>
    </ContextMenuItem>
  );
}
