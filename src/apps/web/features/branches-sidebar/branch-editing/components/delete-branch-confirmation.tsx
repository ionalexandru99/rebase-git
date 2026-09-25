import { IconAlertTriangle } from "@tabler/icons-react";
import { useLayoutEffect, useRef } from "react";
import type { BranchDeletion } from "#web/features/branches-sidebar/branch-editing/branch-row-actions";
import type { PendingDeletion } from "#web/features/branches-sidebar/branch-editing/hooks/use-branch-deletion";
import { PersistentNotification } from "#web/features/notifications/index";
import { Button } from "#web-ui/components/ui/button";

const listedCommits = 3;

export function DeleteBranchConfirmation({
  onCancel,
  onConfirm,
  pending: { busy, deletion, failure },
}: {
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly pending: PendingDeletion;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => cancelRef.current?.focus(), []);
  const title = deletionTitle(deletion);
  return (
    <PersistentNotification>
      <section
        aria-label={title}
        className="pointer-events-auto rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg"
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onCancel();
        }}
        role="alertdialog"
      >
        <div className="flex items-center gap-3">
          <IconAlertTriangle
            aria-hidden="true"
            className="size-4 shrink-0 text-status-connecting"
          />
          <p className="min-w-0 flex-1 wrap-anywhere text-sm font-medium">
            {title}?
          </p>
        </div>
        <div className="mt-1 pl-7 text-xs">
          {failure === undefined ? null : <UnmergedCommits failure={failure} />}
          <div className="mt-2 flex justify-end gap-1.5">
            <Button
              onClick={onCancel}
              ref={cancelRef}
              size="xs"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button
              disabled={busy === true}
              onClick={onConfirm}
              size="xs"
              variant="destructive"
            >
              {busy === true ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      </section>
    </PersistentNotification>
  );
}

function UnmergedCommits({
  failure,
}: {
  readonly failure: NonNullable<PendingDeletion["failure"]>;
}) {
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

function deletionTitle({ local, remote }: BranchDeletion) {
  if (remote === undefined) return `Delete ${local?.name ?? ""}`;
  if (local === undefined) return `Delete ${remote.name} on ${remote.remote}`;
  return `Delete ${local.name} locally and on ${remote.remote}`;
}
