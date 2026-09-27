import type { RepositoryCommit } from "@rebase/contracts";
import { type ReactElement, useCallback, useState } from "react";
import { type Action, ActionMenuItems } from "#web/components/ui/action-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text";
import { createRefActions } from "#web/features/refs/ref-actions";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history";
import { useRepositoryScope } from "#web/platform/query/repository-scope";

interface CommitAccess {
  readonly connected: boolean;
  readonly readable: boolean;
}

interface CommitActionHandlers {
  readonly openDetails?: ((oid: string) => void) | undefined;
  readonly readCommit: (oid: string) => Promise<RepositoryCommit | undefined>;
  readonly writeClipboard: (text: string) => Promise<void>;
  readonly attempt: (work: () => Promise<string | undefined>) => void;
}

export function useCommitActions({
  history,
  onOpenDetails,
}: {
  readonly history: Pick<RepositoryHistory, "ask"> | undefined;
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
  const actionsFor = (oid: string): readonly Action[] => [
    ...commitActions(oid, access, {
      openDetails: onOpenDetails,
      readCommit: async (commit) =>
        (await history?.ask({ _tag: "Commits", oids: [commit] }))?.[0],
      writeClipboard: writeClipboardText,
      attempt,
    }),
    ...createRefActions(oid, access),
  ];
  return { actionsFor, error };
}

function commitActions(
  oid: string,
  { connected, readable }: CommitAccess,
  { openDetails, readCommit, writeClipboard, attempt }: CommitActionHandlers,
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
      <ContextMenuContent>
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
