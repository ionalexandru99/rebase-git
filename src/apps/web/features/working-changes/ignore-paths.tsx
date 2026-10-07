import { useState } from "react";
import type {
  IgnorePaths,
  IgnoreTarget,
  IgnoreTracked,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import { type Action, submenu } from "#web/components/ui/action-menu.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import type { useChangeActions } from "#web/features/working-changes/hooks/use-working-changes.ts";

type IgnoreCommand = ReturnType<typeof useChangeActions>["ignore"];
type IgnoreRequest = Pick<IgnorePaths, "target" | "paths">;

interface PendingIgnore {
  readonly request: IgnoreRequest;
  readonly failure: IgnoreTracked;
}

const targets: readonly {
  readonly target: IgnoreTarget;
  readonly label: string;
}[] = [
  { target: "repository", label: ".gitignore" },
  { target: "local", label: ".git/info/exclude" },
];

export function useIgnorePaths(
  command: IgnoreCommand,
  written: Pick<IgnorePaths, "amend" | "viewed">,
) {
  const errorToast = useErrorToast();
  const [pending, setPending] = useState<PendingIgnore>();
  const run = async (request: IgnoreRequest, untrack: boolean) => {
    const result = await command.run({ ...written, ...request, untrack });
    const failure = result._tag === "Rejected" ? result.failure : undefined;
    setPending(
      failure?._tag === "IgnoreTracked" ? { request, failure } : undefined,
    );
    if (failure?._tag !== "IgnoreTracked") errorToast.failure("ignore", result);
  };
  return {
    actionFor: (paths: readonly string[], enabled: boolean): Action =>
      submenu(
        { id: "ignore", label: "Ignore", group: "edit" },
        targets.map(({ target, label }) => ({
          id: `ignore.${target}`,
          label,
          enabled,
          run: () => void run({ target, paths }, false),
        })),
      ),
    pending,
    confirm: () => {
      if (pending !== undefined) void run(pending.request, true);
    },
    cancel: () => setPending(undefined),
  };
}

export type IgnoreActions = ReturnType<typeof useIgnorePaths>;

export function IgnoreConfirmation({
  ignore,
  busy,
}: {
  readonly ignore: IgnoreActions;
  readonly busy: boolean;
}) {
  const { pending } = ignore;
  if (pending === undefined) return null;
  const { path, count } = pending.failure;
  return (
    <PersistentNotification>
      <Confirmation
        action="Ignore and untrack"
        busy={busy}
        className="px-3 py-2"
        onCancel={ignore.cancel}
        onConfirm={ignore.confirm}
        title={
          count === 1
            ? `Ignore and untrack ${path}?`
            : `Ignore and untrack ${count} files?`
        }
      />
    </PersistentNotification>
  );
}
