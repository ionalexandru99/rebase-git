import { useState } from "react";
import {
  RepositoryReflogApi,
  type ResetDiscardsChanges,
  type ResetMode,
} from "#contracts/repository-reflog/repository-reflog.contract.ts";
import type { Action } from "#web/components/ui/action-menu.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useOperation } from "#web/features/operation-recovery/hooks/use-operation.ts";
import { operationKindLabel } from "#web/features/operation-recovery/operation-messages.ts";
import {
  activeHead,
  type RefSourceTarget,
  refSource,
  useScopedRepositoryRefs,
} from "#web/features/refs/repository-refs.ts";
import { useRepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { useCommand } from "#web/platform/query/use-command.ts";

export type ResetActionId = "reset" | `reset.${ResetMode}`;

export interface ResetActions {
  readonly actionFor: (
    target: RefSourceTarget,
  ) => Action<ResetActionId> | undefined;
  readonly pending: PendingDiscard | undefined;
  readonly running: boolean;
  readonly confirm: () => void;
  readonly cancel: () => void;
}

interface PendingDiscard {
  readonly branch: string;
  readonly label: string;
  readonly target: string;
  readonly expectedHead: string;
  readonly failure: ResetDiscardsChanges;
}

const modes: readonly { readonly mode: ResetMode; readonly label: string }[] = [
  { mode: "soft", label: "Keep changes staged" },
  { mode: "mixed", label: "Keep changes unstaged" },
  { mode: "hard", label: "Discard changes…" },
];
const listedDiscards = 3;

export function useResetActions(): ResetActions {
  const scope = useRepositoryScope();
  const { refs } = useScopedRepositoryRefs();
  const operation = useOperation(scope, false).data;
  const errorToast = useErrorToast();
  const command = useCommand(RepositoryReflogApi.reset);
  const [pending, setPending] = useState<PendingDiscard>();
  const head =
    refs === undefined || scope === undefined
      ? undefined
      : activeHead(refs, scope.worktreePath);
  const branch = head?.branch ?? "HEAD";

  const run = async (
    reset: Omit<PendingDiscard, "failure">,
    mode: ResetMode,
    discard?: string,
  ) => {
    const result = await command.run({
      target: reset.target,
      mode,
      expectedHead: reset.expectedHead,
      ...(discard === undefined ? {} : { discard }),
    });
    const failure = result._tag === "Rejected" ? result.failure : undefined;
    setPending(
      failure?._tag === "ResetDiscardsChanges"
        ? { ...reset, failure }
        : undefined,
    );
    if (failure?._tag === "ResetDiscardsChanges") return;
    errorToast.failure("reset", result, {
      HeadMoved: () =>
        `${reset.branch} moved before the reset ran. Nothing changed.`,
      RefMissing: () => "That commit no longer exists.",
    });
  };

  const actionFor = (
    target: RefSourceTarget,
  ): Action<ResetActionId> | undefined => {
    const source = refs === undefined ? undefined : refSource(refs, target);
    if (
      source === undefined ||
      head === undefined ||
      scope?.writable !== true ||
      source.commit === head.commit
    )
      return undefined;
    const reason =
      operation !== undefined && operation.kind !== "idle"
        ? `${operationKindLabel(operation.kind)} in progress`
        : command.running
          ? "Resetting…"
          : undefined;
    const reset = {
      branch,
      label: source.label,
      target: source.commit,
      expectedHead: head.commit,
    };
    return {
      id: "reset",
      label: "Reset",
      group: "operation",
      enabled: reason === undefined,
      ...(reason === undefined ? {} : { reason }),
      run: () => undefined,
      submenu: {
        actions: modes.map(({ mode, label }) => ({
          id: `reset.${mode}`,
          label,
          enabled: true,
          run: () => void run(reset, mode),
        })),
      },
    };
  };

  return {
    actionFor,
    pending,
    running: command.running,
    confirm: () => {
      if (pending !== undefined)
        void run(pending, "hard", pending.failure.fingerprint);
    },
    cancel: () => setPending(undefined),
  };
}

export function ResetConfirmation({ reset }: { readonly reset: ResetActions }) {
  const { pending } = reset;
  if (pending === undefined) return null;
  const { paths, count, fingerprint } = pending.failure;
  const hidden = count - Math.min(count, listedDiscards);
  return (
    <PersistentNotification>
      <Confirmation
        action="Discard and reset"
        busy={reset.running}
        className="px-3 py-2"
        key={fingerprint}
        onCancel={reset.cancel}
        onConfirm={reset.confirm}
        title={`Reset ${pending.branch} to ${pending.label} and discard changes?`}
      >
        <p>
          {count === 1
            ? "Uncommitted edits in 1 file will be lost."
            : `Uncommitted edits in ${count} files will be lost.`}{" "}
          The reflog can't bring them back.
        </p>
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {paths.slice(0, listedDiscards).map((path) => (
            <li className="truncate font-mono text-foreground" key={path}>
              {path}
            </li>
          ))}
        </ul>
        {hidden === 0 ? null : <p className="mt-0.5">and {hidden} more</p>}
      </Confirmation>
    </PersistentNotification>
  );
}
