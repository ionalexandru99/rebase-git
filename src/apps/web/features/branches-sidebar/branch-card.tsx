import { PreviewCard } from "@base-ui/react/preview-card";
import {
  IconCloud,
  IconCloudOff,
  IconGitBranchDeleted,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";
import type { PullRequest } from "#contracts/pull-requests/pull-requests.contract.ts";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import type { RemoteBranch } from "#contracts/repository-refs/repository-refs.contract.ts";
import { AuthorAvatar } from "#web/features/author-avatars/author-avatar.tsx";
import type { BranchesSidebarRefRow } from "#web/features/branches-sidebar/branches-sidebar-state.ts";
import {
  LinkPullRequestField,
  usePullRequestLinking,
} from "#web/features/pull-requests/pull-request-links.tsx";
import {
  PullRequestList,
  type PullRequests,
} from "#web/features/pull-requests/pull-requests.tsx";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { worktreeName } from "#web/features/worktrees/worktree-draft.ts";
import { ageLabel, useNow } from "#web/lib/age-label.ts";

export interface BranchCardBranch {
  readonly row: BranchesSidebarRefRow;
}

const noPullRequests: readonly PullRequest[] = [];

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

export function branchCardTriggerId(rowId: string) {
  return `branch-card-${rowId}`;
}

export function BranchCard({
  handle,
  history,
  linking,
  onLinkingEnd,
  pullRequests,
  remoteBranches,
}: {
  readonly handle: BranchCardHandle;
  readonly history: Pick<RepositoryHistory, "ask"> | undefined;
  readonly linking: string | undefined;
  readonly onLinkingEnd: () => void;
  readonly pullRequests: PullRequests | undefined;
  readonly remoteBranches: readonly RemoteBranch[];
}) {
  return (
    <PreviewCard.Root
      handle={handle}
      onOpenChange={(open, details) => {
        if (linking === undefined) return;
        if (
          details.reason === "trigger-hover" ||
          details.reason === "trigger-focus"
        )
          details.cancel();
        else if (!open) onLinkingEnd();
      }}
    >
      {({ payload }) =>
        payload === undefined ? null : (
          <PreviewCard.Portal>
            <PreviewCard.Positioner
              align="start"
              className="isolate z-100 transition-[top,left,right,bottom,transform] duration-150 ease-out motion-reduce:transition-none"
              side="right"
              sideOffset={16}
            >
              <PreviewCard.Popup
                aria-label={payload.row.name}
                role="group"
                className="w-[23rem] max-w-(--available-width) origin-(--transform-origin) rounded-lg border border-border bg-popover px-3.5 py-3 text-popover-foreground shadow-[0_.75rem_2.5rem_rgb(0_0_0/14%)] dark:shadow-[0_.75rem_2.5rem_rgb(0_0_0/45%)] outline-none transition-[scale,opacity] duration-150 ease-out data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0 motion-reduce:transition-none"
              >
                <BranchCardBody
                  history={history}
                  linking={linking === payload.row.name}
                  onLinked={() => handle.close()}
                  pullRequests={
                    pullRequests?.forBranch(payload.row.name) ?? noPullRequests
                  }
                  remoteBranches={remoteBranches}
                  row={payload.row}
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
  history,
  linking,
  onLinked,
  pullRequests,
  remoteBranches,
  row,
}: {
  readonly history: Pick<RepositoryHistory, "ask"> | undefined;
  readonly linking: boolean;
  readonly onLinked: () => void;
  readonly pullRequests: readonly PullRequest[];
  readonly remoteBranches: readonly RemoteBranch[];
  readonly row: BranchesSidebarRefRow;
}) {
  const now = useNow();
  const setLinked = usePullRequestLinking();
  const commit = useTipCommit(history, row.tip);
  return (
    <>
      <p className="text-[.9rem] font-medium wrap-anywhere not-last:mb-1.5">
        {row.name}
      </p>
      {commit === undefined ? null : (
        <>
          <p className="mb-2 line-clamp-2 text-[.85rem] text-foreground/85">
            {commit.subject}
          </p>
          <div className="flex h-6 min-w-0 items-center gap-2 text-[.8rem] text-muted-foreground">
            <AuthorAvatar commit={commit} />
            <span className="min-w-0 truncate">
              {commit.author.name} ·{" "}
              {ageLabel(commit.committer.timestampSeconds, now)}
            </span>
          </div>
        </>
      )}
      {row.settled === undefined ? null : (
        <CardLine icon={<IconGitBranchDeleted className="size-3.5" />}>
          {settledLabel(row.settled, now)}
        </CardLine>
      )}
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
          <PullRequestList
            focusable={linking}
            onUnlink={(pullRequest) => setLinked(row.name, pullRequest, false)}
            pullRequests={pullRequests}
          />
        </>
      ) : null}
      {linking ? (
        <>
          <div className="my-2 h-px bg-border" />
          <LinkPullRequestField
            branch={row.name}
            onLinked={onLinked}
            setLinked={setLinked}
          />
        </>
      ) : null}
    </>
  );
}

function useTipCommit(
  history: Pick<RepositoryHistory, "ask"> | undefined,
  tip: string | undefined,
) {
  const [commit, setCommit] = useState<RepositoryCommit>();
  useEffect(() => {
    if (history === undefined || tip === undefined) return;
    const controller = new AbortController();
    history
      .ask({ _tag: "Commits", oids: [tip] }, controller.signal)
      .then(([found]) => setCommit(found))
      .catch(() => undefined);
    return () => controller.abort();
  }, [history, tip]);
  return commit?.oid === tip ? commit : undefined;
}

function settledLabel(day: string, now: number) {
  const today = new Date(now);
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const days = Math.round(
    (Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(year, month - 1, date)) /
      86_400_000,
  );
  if (days <= 0) return "Settled today";
  if (days === 1) return "Settled yesterday";
  return `Settled ${days} days ago`;
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
