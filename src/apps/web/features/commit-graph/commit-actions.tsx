import { type ReactElement, useCallback, useRef, useState } from "react";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import { RepositoryOperationsApi } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type Action,
  ActionMenuItems,
  submenu,
} from "#web/components/ui/action-menu.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import type { CherryPick } from "#web/features/cherry-pick/cherry-pick-menu.tsx";
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
  readonly cherryPick: Action | undefined;
  readonly merge: Action | undefined;
  readonly rebase: Action | undefined;
  readonly revert: Action | undefined;
  readonly reset: Action | undefined;
  readonly create: readonly Action[];
  readonly readCommit: (oid: string) => Promise<RepositoryCommit | undefined>;
  readonly writeClipboard: (text: string) => Promise<void>;
  readonly attempt: Attempt;
}

export function useCommitActions({
  history,
  scope: historyScope,
  cherryPick,
  merge,
  rebase,
  reset,
  onOpenDetails,
}: {
  readonly history: Pick<RepositoryHistory, "ask"> | undefined;
  readonly scope: HistoryScopeQuery | undefined;
  readonly cherryPick?: Pick<CherryPick, "action"> | undefined;
  readonly merge?: MergeActions | undefined;
  readonly rebase?: Pick<RebaseActions, "actionFor"> | undefined;
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
      cherryPick: cherryPick?.action(),
      merge: merge?.actionFor(oid),
      rebase: rebase?.actionFor(oid),
      revert: revert.actionFor(selected),
      reset: reset?.actionFor(oid),
      create: createRefActions(oid, access),
      readCommit: async (commit) =>
        (await history?.ask({ _tag: "Commits", oids: [commit] }))?.[0],
      writeClipboard: writeClipboardText,
      attempt,
    }),
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
  const actionFor = (commits: readonly string[]): Action | undefined => {
    if (head === undefined || repository?.writable !== true) return undefined;
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
      onHighlight: (on: boolean) => show(on ? commits : []),
    };
    return {
      ...submenu(
        {
          id: "revert",
          label:
            commits.length === 1
              ? "Revert"
              : `Revert ${commits.length} commits`,
          group: "operation",
        },
        [
          {
            ...shared,
            id: "revert.commit",
            label: "Commit",
            run: () => run(true),
          },
          {
            ...shared,
            id: "revert.stage",
            label: "Stage without committing",
            run: () => run(false),
          },
        ],
      ),
      onHighlight: shared.onHighlight,
    };
  };
  return { actionFor, preview };
}

function commitActions(
  oid: string,
  { connected, readable }: CommitAccess,
  {
    openDetails,
    cherryPick,
    merge,
    rebase,
    revert,
    reset,
    create,
    readCommit,
    writeClipboard,
    attempt,
  }: CommitActionHandlers,
): readonly Action[] {
  const copy = (
    id: string,
    label: string,
    text: () => Promise<string | undefined>,
  ) => ({
    id,
    label,
    enabled: true,
    run: () =>
      attempt(async () => {
        const value = await text();
        if (value === undefined) return "Commit metadata is not available yet";
        await writeClipboard(value);
        return undefined;
      }),
  });
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
    ...[cherryPick, merge, rebase, revert, reset].filter(
      (action) => action !== undefined,
    ),
    ...create,
    submenu({ id: "copy", label: "Copy", group: "edit" }, [
      copy("copySha", "SHA", async () => oid),
      copy(
        "copySubject",
        "Subject",
        async () => (await readCommit(oid))?.subject,
      ),
    ]),
  ];
}

export function CommitActionMenu({
  children,
  actions,
  restoreFocus,
  tabIndex = -1,
}: {
  readonly tabIndex?: number;
  readonly children: ReactElement;
  readonly actions: readonly Action[] | undefined;
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
        {actions === undefined ? null : <ActionMenuItems actions={actions} />}
      </ContextMenuContent>
    </ContextMenu>
  );
}
