import { IconCircleCheck, IconX } from "@tabler/icons-react";
import { useEffect } from "react";
import type { BranchNotMerged } from "#contracts/repository-refs/repository-branches.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import {
  deletionTitle,
  type RefEditing,
} from "#web/features/refs/ref-editing.ts";

const listedCommits = 3;
const deletedNoticeMilliseconds = 10_000;

export function RefEditingStatus({
  editing,
  checkoutError,
}: {
  readonly editing: RefEditing;
  readonly checkoutError: string | null;
}) {
  const { deletion } = editing;
  return (
    <>
      <RefAlert message={editing.error} />
      {deletion.pending === undefined ? null : (
        <PersistentNotification>
          <Confirmation
            action="Delete"
            busy={deletion.pending.busy}
            className="px-3 py-2"
            key={
              deletion.pending.failure === undefined ? "confirm" : "unmerged"
            }
            onCancel={deletion.cancel}
            onConfirm={deletion.confirm}
            title={deletionTitle(deletion.pending.deletion)}
          >
            {deletion.pending.failure === undefined ? undefined : (
              <UnmergedCommits failure={deletion.pending.failure} />
            )}
          </Confirmation>
        </PersistentNotification>
      )}
      {deletion.deleted === undefined ? null : (
        <DeletedNotice
          key={deletion.deleted.name}
          name={deletion.deleted.name}
          onDismiss={deletion.dismiss}
          onUndo={deletion.undo}
        />
      )}
      {editing.notice === undefined ? null : (
        <DoneNotice
          message={editing.notice}
          onDismiss={editing.dismissNotice}
        />
      )}
      <RefAlert message={checkoutError ?? undefined} />
    </>
  );
}

function RefAlert({ message }: { readonly message: string | undefined }) {
  return message === undefined ? null : (
    <p
      className="mx-3 mb-3 rounded-md border border-status-unavailable/40 bg-status-unavailable/10 px-3 py-2 text-xs text-foreground"
      role="alert"
    >
      {message}
    </p>
  );
}

function UnmergedCommits({ failure }: { readonly failure: BranchNotMerged }) {
  const hidden = failure.count - Math.min(failure.count, listedCommits);
  return (
    <>
      <p className="text-muted-foreground">
        {failure.count === 1
          ? "1 commit exists only on this branch."
          : `${failure.count} commits exist only on this branch.`}
      </p>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {failure.commits.slice(0, listedCommits).map((commit) => (
          <li className="flex min-w-0 gap-2" key={commit.oid}>
            <span className="shrink-0 font-mono text-muted-foreground">
              {commit.oid.slice(0, 7)}
            </span>
            <span className="truncate">{commit.subject}</span>
          </li>
        ))}
      </ul>
      {hidden === 0 ? null : (
        <p className="mt-0.5 text-muted-foreground">and {hidden} more</p>
      )}
    </>
  );
}

function DeletedNotice({
  name,
  onDismiss,
  onUndo,
}: {
  readonly name: string;
  readonly onDismiss: () => void;
  readonly onUndo: () => void;
}) {
  useEffect(() => {
    const timeout = setTimeout(onDismiss, deletedNoticeMilliseconds);
    return () => clearTimeout(timeout);
  }, [onDismiss]);
  return (
    <PersistentNotification>
      <div className="flex items-center gap-3 px-3 py-2" role="status">
        <IconCircleCheck
          aria-hidden="true"
          className="size-4 shrink-0 text-status-available"
        />
        <p className="min-w-0 flex-1 wrap-anywhere text-sm font-medium">
          Deleted {name}
        </p>
        <Button onClick={onUndo} size="xs" variant="ghost">
          Undo
        </Button>
        <Button
          aria-label="Dismiss notification"
          onClick={onDismiss}
          size="icon-xs"
          variant="ghost"
        >
          <IconX aria-hidden="true" />
        </Button>
      </div>
    </PersistentNotification>
  );
}

export function DoneNotice({
  message,
  onDismiss,
}: {
  readonly message: string;
  readonly onDismiss: () => void;
}) {
  return (
    <PersistentNotification>
      <div className="flex items-center gap-3 px-3 py-2" role="status">
        <IconCircleCheck
          aria-hidden="true"
          className="size-4 shrink-0 text-status-available"
        />
        <p className="min-w-0 flex-1 wrap-anywhere text-sm font-medium">
          {message}
        </p>
        <Button
          aria-label="Dismiss notification"
          onClick={onDismiss}
          size="icon-xs"
          variant="ghost"
        >
          <IconX aria-hidden="true" />
        </Button>
      </div>
    </PersistentNotification>
  );
}
