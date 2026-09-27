import { Combobox } from "@base-ui/react/combobox";
import {
  IconCheck,
  IconCircleCheck,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo } from "react";
import type {
  BranchNotMerged,
  BranchUpstreamTarget,
} from "#contracts/repository-refs/repository-branches.contract.ts";
import type {
  LocalBranch,
  RemoteBranch,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import {
  deletionTitle,
  type RefEditing,
} from "#web/features/refs/ref-editing.ts";

interface UpstreamChoice {
  readonly label: string;
  readonly upstream: BranchUpstreamTarget | null;
}

const noUpstream: UpstreamChoice = { label: "None", upstream: null };
const visibleChoices = 100;
const listedCommits = 3;
const deletedNoticeMilliseconds = 10_000;

export function RefEditingStatus({
  editing,
  remoteBranches,
  anchor,
  checkoutError,
}: {
  readonly editing: RefEditing;
  readonly remoteBranches: readonly RemoteBranch[];
  readonly anchor: (rowId: string) => Element | null;
  readonly checkoutError: string | null;
}) {
  const { deletion, edit } = editing;
  return (
    <>
      <RefAlert message={editing.error} />
      {edit?.kind !== "upstream" ? null : (
        <UpstreamPicker
          anchor={() => anchor(edit.rowId)}
          branch={edit.branch}
          onChoose={(upstream) => void editing.setUpstream(upstream)}
          onClose={editing.cancel}
          remoteBranches={remoteBranches}
        />
      )}
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

function UpstreamPicker({
  anchor,
  branch,
  onChoose,
  onClose,
  remoteBranches,
}: {
  readonly anchor: () => Element | null;
  readonly branch: LocalBranch;
  readonly onChoose: (upstream: BranchUpstreamTarget | null) => void;
  readonly onClose: () => void;
  readonly remoteBranches: readonly RemoteBranch[];
}) {
  const choices = useMemo(
    () => [
      ...remoteBranches.map(
        ({ name, remote }): UpstreamChoice => ({
          label: `${remote}/${name}`,
          upstream: { name, remote },
        }),
      ),
      noUpstream,
    ],
    [remoteBranches],
  );
  const current =
    choices.find((choice) => choice.label === branch.upstream?.name) ??
    noUpstream;
  return (
    <Combobox.Root
      autoHighlight
      isItemEqualToValue={(item, value) => item.label === value.label}
      itemToStringLabel={(item) => item.label}
      items={choices}
      limit={visibleChoices}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      onValueChange={(choice) => {
        if (choice === null) return;
        onChoose(choice.upstream);
      }}
      open
      value={current}
    >
      <Combobox.Portal>
        <Combobox.Positioner
          align="start"
          anchor={anchor}
          className="isolate z-50"
          sideOffset={4}
        >
          <Combobox.Popup
            aria-label={`Upstream for ${branch.name}`}
            className="w-80 max-w-[var(--available-width)] rounded-[.55rem] border border-border bg-popover p-[.3rem] text-popover-foreground shadow-[0_.75rem_2.5rem_rgb(0_0_0/45%)] outline-none"
          >
            <div className="-mx-[.3rem] -mt-[.3rem] mb-1 flex items-center gap-2 border-border border-b px-2.5">
              <IconSearch
                aria-hidden="true"
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <Combobox.Input
                aria-label="Filter remote branches"
                className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                placeholder="Filter remote branches"
              />
            </div>
            <Combobox.Empty className="px-2 py-1.5 text-xs text-muted-foreground empty:hidden">
              No remote branches match.
            </Combobox.Empty>
            <Combobox.List className="max-h-72 overflow-y-auto">
              {(choice: UpstreamChoice) => (
                <Combobox.Item
                  className="flex h-8 cursor-default items-center gap-2 rounded-[.35rem] px-2 text-xs text-foreground/80 outline-none select-none data-highlighted:bg-accent data-highlighted:text-foreground"
                  key={choice.label}
                  value={choice}
                >
                  <span className="grid size-3.5 shrink-0 place-items-center text-primary">
                    <Combobox.ItemIndicator>
                      <IconCheck aria-hidden="true" className="size-3.5" />
                    </Combobox.ItemIndicator>
                  </span>
                  <span className="truncate">{choice.label}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}
