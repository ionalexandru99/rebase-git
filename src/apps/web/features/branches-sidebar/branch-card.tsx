import { PreviewCard } from "@base-ui/react/preview-card";
import { IconCloud, IconCloudOff } from "@tabler/icons-react";
import type { ReactNode } from "react";
import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import type { RemoteBranch } from "#contracts/repository-refs/repository-refs.contract.ts";
import type { BranchesSidebarRefRow } from "#web/features/branches-sidebar/branches-sidebar-state.ts";
import { PullRequestList } from "#web/features/pull-requests/pull-requests.tsx";
import { worktreeName } from "#web/features/worktrees/worktree-draft.ts";

export interface BranchCardBranch {
  readonly row: BranchesSidebarRefRow;
  readonly pullRequests: readonly PullRequest[];
}

export type BranchCardHandle = PreviewCard.Handle<BranchCardBranch>;

export function createBranchCardHandle(): BranchCardHandle {
  return PreviewCard.createHandle<BranchCardBranch>();
}

export function BranchCardTrigger(
  props: PreviewCard.Trigger.Props<BranchCardBranch>,
) {
  return (
    <PreviewCard.Trigger
      delay={500}
      closeDelay={0}
      {...props}
      onFocus={(event) => {
        event.preventBaseUIHandler();
        props.onFocus?.(event);
      }}
    />
  );
}

export function BranchCard({
  handle,
  remoteBranches,
}: {
  readonly handle: BranchCardHandle;
  readonly remoteBranches: readonly RemoteBranch[];
}) {
  return (
    <PreviewCard.Root handle={handle}>
      {({ payload }) =>
        payload === undefined ? null : (
          <PreviewCard.Portal>
            <PreviewCard.Positioner
              align="start"
              className="isolate z-100 transition-[top,left,right,bottom,transform] duration-150 ease-out data-instant:transition-none motion-reduce:transition-none"
              side="right"
              sideOffset={16}
            >
              <PreviewCard.Popup
                aria-label={payload.row.name}
                role="group"
                className="w-[23rem] max-w-(--available-width) origin-(--transform-origin) rounded-lg border border-border bg-popover px-3.5 py-3 text-popover-foreground shadow-[0_.75rem_2.5rem_rgb(0_0_0/45%)] outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0 motion-reduce:transition-none"
              >
                <BranchCardBody
                  branch={payload}
                  remoteBranches={remoteBranches}
                />
              </PreviewCard.Popup>
            </PreviewCard.Positioner>
          </PreviewCard.Portal>
        )
      }
    </PreviewCard.Root>
  );
}

function BranchCardBody({
  branch,
  remoteBranches,
}: {
  readonly branch: BranchCardBranch;
  readonly remoteBranches: readonly RemoteBranch[];
}) {
  const { row, pullRequests } = branch;
  return (
    <>
      <p className="text-[.9rem] font-medium wrap-anywhere not-last:mb-1.5">
        {row.name}
      </p>
      {row.checkout?.kind === "worktree" ? (
        <CardLine icon={<WorktreeGlyph />}>
          Worktree {worktreeName(row.checkout.path)}
        </CardLine>
      ) : null}
      {neverPushed(row, remoteBranches) ? (
        <CardLine icon={<IconCloud className="size-3.5" />}>
          Never pushed
        </CardLine>
      ) : row.upstream?.gone ? (
        <CardLine icon={<IconCloudOff className="size-3.5" />}>
          Remote branch deleted
        </CardLine>
      ) : null}
      {pullRequests.length > 0 ? (
        <>
          <div className="my-2 h-px bg-border" />
          <PullRequestList pullRequests={pullRequests} />
        </>
      ) : null}
    </>
  );
}

function neverPushed(
  row: BranchesSidebarRefRow,
  remoteBranches: readonly RemoteBranch[],
): boolean {
  return (
    row.upstream === undefined &&
    !remoteBranches.some((remote) => remote.name === row.name)
  );
}

function CardLine({
  icon,
  children,
}: {
  readonly icon: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex h-6 min-w-0 items-center gap-2.5 text-[.85rem] text-foreground/85">
      <span
        aria-hidden="true"
        className="grid size-4 shrink-0 place-items-center text-muted-foreground"
      >
        {icon}
      </span>
      <span className="min-w-0 truncate">{children}</span>
    </div>
  );
}

function WorktreeGlyph() {
  return (
    <svg
      aria-hidden="true"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.65"
      viewBox="0 0 24 24"
    >
      <path d="M10 19H3V5h6l2 3h10v3" />
      <circle cx="15" cy="14" r="1.5" />
      <circle cx="21" cy="17" r="1.5" />
      <circle cx="15" cy="21" r="1.5" />
      <path d="M15 15.5v4M15 18h3a3 3 0 0 0 2-1" />
    </svg>
  );
}
