import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type Action,
  ActionMenuItems,
} from "#web/components/ui/action-menu.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text.ts";
import type { MergeActions } from "#web/features/merge/merge-actions.ts";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation.ts";
import { operationKindLabel } from "#web/features/operation-recovery/operation-messages.ts";
import type { RebaseActions } from "#web/features/rebase/rebase-actions.ts";
import { createRefActions } from "#web/features/refs/ref-actions.ts";
import {
  activeHead,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import type { HistoryScopeQuery } from "#web/features/repository-history/history-view.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import type { ResetActions } from "#web/features/reset/reset-actions.tsx";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { describeFailure } from "#web/platform/query/request-failure.ts";
import { answer, useCommand } from "#web/platform/query/use-command.ts";

type Attempt = (work: () => Promise<string | undefined>) => void;

const maximumReverted = 256;

interface CommitAccess {
  readonly connected: boolean;
  readonly readable: boolean;
}

interface CommitActionHandlers {
  readonly openDetails?: ((oid: string) => void) | undefined;
  readonly merge: Action | undefined;
  readonly rebase: readonly (Action | undefined)[];
  readonly reset: Action | undefined;
  readonly revert: readonly Action[];
  readonly readCommit: (oid: string) => Promise<RepositoryCommit | undefined>;
  readonly writeClipboard: (text: string) => Promise<void>;
  readonly attempt: Attempt;
}

export function useCommitActions({
  history,
  scope: historyScope,
  merge,
  rebase,
  reset,
  onOpenDetails,
}: {
  readonly history: Pick<RepositoryHistory, "ask"> | undefined;
  readonly scope: HistoryScopeQuery | undefined;
  readonly merge?: MergeActions | undefined;
  readonly rebase?:
    | Pick<RebaseActions, "actionFor" | "interactiveFor">
    | undefined;
  readonly reset?: Pick<ResetActions, "actionFor"> | undefined;
  readonly onOpenDetails?: ((oid: string) => void) | undefined;
}) {
  const scope = useRepositoryScope();
  const [error, setError] = useState<string>();
  const attempt = useCallback((work: () => Promise<string | undefined>) => {
    setError(undefined);
    void work().then(setError, () =>
      setError("The command could not be completed. Try again."),
    );
  }, []);
  const access = {
    connected: scope?.connected ?? false,
    readable: scope?.readable ?? false,
    writable: scope?.writable ?? false,
  };
  const revert = useRevertActions(history, historyScope, attempt);
  const actionsFor = (
    oid: string,
    selected: readonly string[] = [oid],
  ): readonly Action[] => [
    ...commitActions(oid, access, {
      openDetails: onOpenDetails,
      merge: merge?.actionFor(oid),
      rebase: [rebase?.actionFor(oid), rebase?.interactiveFor(oid)],
      reset: reset?.actionFor(oid),
      revert: revert.actionsFor(selected),
      readCommit: async (commit) =>
        (await history?.ask({ _tag: "Commits", oids: [commit] }))?.[0],
      writeClipboard: writeClipboardText,
      attempt,
    }),
    ...createRefActions(oid, access),
  ];
  return { actionsFor, error, preview: revert.preview };
}

function useRevertActions(
  history: Pick<RepositoryHistory, "ask"> | undefined,
  scope: HistoryScopeQuery | undefined,
  attempt: Attempt,
) {
  const repository = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  const operation = useOperation(repository, false).data;
  const start = useCommand(RepositoryOperationsApi.start, {
    answers: (value, { repositoryId, worktreePath }) => [
      answer(
        RepositoryOperationsApi.read,
        { repositoryId, worktreePath },
        value.operation,
      ),
    ],
  });
  const [preview, setPreview] = useState<readonly string[]>([]);
  const highlight = useRef(0);
  const head =
    refs === undefined || repository === undefined
      ? undefined
      : activeHead(refs, repository.worktreePath);
  const newestFirst = async (commits: readonly string[]) => {
    if (commits.length < 2 || history === undefined || scope === undefined)
      return commits;
    const rows = await history.ask({ _tag: "Locate", scope, oids: commits });
    return commits
      .map((oid, index) => ({ oid, row: rows[index] ?? Infinity }))
      .sort((left, right) => left.row - right.row)
      .map(({ oid }) => oid);
  };
  const show = (commits: readonly string[]) => {
    const current = ++highlight.current;
    if (commits.length < 2) {
      setPreview([]);
      return;
    }
    void newestFirst(commits).then(
      (ordered) => {
        if (current === highlight.current) setPreview(ordered);
      },
      () => undefined,
    );
  };
  const actionsFor = (commits: readonly string[]): readonly Action[] => {
    if (head === undefined || repository?.writable !== true) return [];
    const run = (commit: boolean) =>
      attempt(async () => {
        const result = await start.run({
          expectedHead: head.commit,
          operation: {
            _tag: "Revert",
            commits: await newestFirst(commits),
            commit,
          },
        });
        return result._tag === "Ok" ? undefined : describeFailure(result);
      });
    const reason =
      operation !== undefined && operation.kind !== "idle"
        ? `${operationKindLabel(operation.kind)} in progress`
        : start.running
          ? "Reverting…"
          : commits.length > maximumReverted
            ? `${maximumReverted} commits at most`
            : undefined;
    const shared = {
      enabled: reason === undefined && start.canRun,
      ...(reason === undefined ? {} : { reason }),
      group: "operation" as const,
      onHighlight: (on: boolean) => show(on ? commits : []),
    };
    return [
      {
        ...shared,
        id: "revert",
        label:
          commits.length === 1
            ? "Revert commit"
            : `Revert ${commits.length} commits`,
        ...(head.branch === undefined ? {} : { detail: `on ${head.branch}` }),
        run: () => run(true),
      },
      {
        ...shared,
        id: "revertWithoutCommit",
        label: "Revert without committing",
        run: () => run(false),
      },
    ];
  };
  return { actionsFor, preview };
}

function commitActions(
  oid: string,
  { connected, readable }: CommitAccess,
  {
    openDetails,
    merge,
    rebase,
    reset,
    revert,
    readCommit,
    writeClipboard,
    attempt,
  }: CommitActionHandlers,
): readonly Action[] {
  return [
    ...(openDetails === undefined
      ? []
      : [
          {
            id: "openDetails",
            label: "Open details",
            enabled: connected && readable,
            run: () =>
              attempt(async () => {
                openDetails(oid);
                return undefined;
              }),
          },
        ]),
    ...(merge === undefined ? [] : [merge]),
    ...rebase.filter((action) => action !== undefined),
    ...(reset === undefined ? [] : [reset]),
    ...revert,
    {
      id: "copySha",
      label: "Copy commit SHA",
      enabled: true,
      run: () =>
        attempt(async () => {
          await writeClipboard(oid);
          return undefined;
        }),
    },
    {
      id: "copySubject",
      label: "Copy commit subject",
      enabled: true,
      run: () =>
        attempt(async () => {
          const commit = await readCommit(oid);
          if (commit === undefined)
            return "Commit metadata is not available yet";
          await writeClipboard(commit.subject);
          return undefined;
        }),
    },
  ];
}

export function CommitActionMenu({
  children,
  actions,
  lead,
  restoreFocus,
  tabIndex = -1,
}: {
  readonly tabIndex?: number;
  readonly children: ReactElement;
  readonly actions: readonly Action[] | undefined;
  readonly lead?: ReactNode;
  readonly restoreFocus: () => void;
}) {
  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (!open) restoreFocus();
      }}
    >
      <ContextMenuTrigger render={children} tabIndex={tabIndex} />
      <ContextMenuContent className="w-max min-w-50 max-w-md">
        {lead}
        {actions === undefined ? null : (
          <ActionMenuItems
            actions={actions}
            className="text-[.85rem] sm:text-[.85rem]"
          />
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
