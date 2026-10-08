import { IconFolder, IconSelector } from "@tabler/icons-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { ConfirmNotice } from "#web/features/notifications/components/persistent-notification.tsx";
import type { StartPoint } from "#web/features/refs/ref-kinds.ts";
import {
  useWorktreeDraftRequest,
  type WorktreeDraft,
} from "#web/features/worktrees/worktree-draft.ts";
import { WorktreeForm } from "#web/features/worktrees/worktree-form.tsx";
import { WorktreeList } from "#web/features/worktrees/worktree-list.tsx";
import {
  useWorktrees,
  type WorktreeRow,
  type Worktrees,
} from "#web/features/worktrees/worktrees.ts";

export function WorktreeSwitcher() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<WorktreeDraft>();
  const [hovered, setHovered] = useState(false);
  const worktrees = useWorktrees(open || hovered);
  useWorktreeDraftRequest((next) => {
    setDraft(next);
    setOpen(true);
  });
  const close = () => {
    setOpen(false);
    setDraft(undefined);
  };
  const active = worktrees.rows.find((row) => row.active);
  if (worktrees.refs === undefined || active === undefined) return null;
  const linked = !active.worktree.main;
  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next, details) => {
          if (!next && insideMenu(details.event)) return details.cancel();
          if (next) setOpen(true);
          else close();
        }}
      >
        <PopoverTrigger
          aria-label={`Worktree ${active.name}`}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          className="flex h-7 min-w-0 items-center gap-1.5 rounded-control px-1.5 text-body text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30 aria-expanded:bg-muted aria-expanded:text-foreground"
        >
          {linked ? (
            <>
              <span aria-hidden="true">/</span>
              <IconFolder aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="max-w-48 truncate text-foreground">
                {active.name}
              </span>
            </>
          ) : null}
          <IconSelector aria-hidden="true" className="size-3.5 shrink-0" />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label="Worktrees"
          className="w-[22rem] p-1"
        >
          {draft === undefined ? (
            <WorktreeList
              worktrees={worktrees}
              onClose={close}
              onCreate={() => setDraft({ name: "", start: undefined })}
            />
          ) : (
            <WorktreeForm
              worktrees={worktrees}
              draft={draft}
              fallback={activeStart(active)}
              onCancel={() => setDraft(undefined)}
              onDone={close}
            />
          )}
        </PopoverContent>
      </Popover>
      <RemoveConfirmation confirmation={worktrees.confirmation} />
    </>
  );
}

function RemoveConfirmation({
  confirmation,
}: {
  readonly confirmation: Worktrees["confirmation"];
}) {
  const { row, changes, busy, confirm, cancel } = confirmation;
  if (row === undefined) return null;
  return (
    <ConfirmNotice
      key={changes}
      notice="removeWorktree"
      action="Remove"
      busy={busy ? "Removing" : undefined}
      onCancel={cancel}
      onConfirm={confirm}
      title={`Remove ${row.name}?`}
    >
      Its uncommitted changes will be deleted.
    </ConfirmNotice>
  );
}

function activeStart(row: WorktreeRow): StartPoint {
  const { head } = row.worktree;
  return {
    label: head.branch ?? head.commit.slice(0, 7),
    name: "",
    oid: head.commit,
  };
}

function insideMenu(event: Event | undefined) {
  return (
    event?.target instanceof Element &&
    event.target.closest("[data-slot=context-menu-content]") !== null
  );
}
