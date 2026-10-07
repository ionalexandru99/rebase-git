import { memo, type ReactNode } from "react";
import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "#contracts/repository-history/repository-history.contract.ts";
import { AuthorAvatar } from "#web/features/author-avatars/author-avatar.tsx";
import { CommitMessage } from "#web/features/commit-graph/components/commit-message.tsx";
import {
  graphAuthorCellClassName,
  graphAuthorNameClassName,
  graphShaCellClassName,
} from "#web/features/commit-graph/layout/graph-geometry.ts";

export const CommitGraphCommitCells = memo(
  function CommitGraphCommitCells({
    commit,
    labels,
    graph,
    order,
  }: {
    readonly labels: readonly RepositoryHistoryRefTarget[];
    readonly commit: RepositoryCommit;
    readonly graph?: ReactNode;
    readonly order: number;
  }) {
    const date = new Date(commit.committer.timestampSeconds * 1_000);
    const formattedDate = dateFormatter.format(date);
    const shownDate = (
      date.getFullYear() === currentYear ? dayFormatter : monthFormatter
    ).format(date);
    return (
      <>
        <td
          role="gridcell"
          tabIndex={-1}
          aria-label={`${commit.parents.length} parents`}
        >
          {graph}
        </td>
        <td role="gridcell" tabIndex={-1} className="h-full min-w-0">
          <CommitMessage
            key={commit.oid}
            subject={commit.subject}
            labels={labels}
            order={order}
          />
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className={`${graphAuthorCellClassName} z-[4] flex h-full min-w-0 items-center gap-1.5 bg-[var(--graph-row-background)] px-3 text-muted-foreground`}
          aria-label={`Author ${commit.author.name}`}
        >
          <AuthorAvatar commit={commit} />
          <span className={`truncate ${graphAuthorNameClassName}`}>
            {commit.author.name}
          </span>
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className={`${graphShaCellClassName} z-[4] flex h-full items-center bg-[var(--graph-row-background)] pr-3 font-sans text-[.85rem] text-muted-foreground`}
          aria-label={`Commit SHA ${commit.oid}`}
        >
          <span>{shortOid(commit.oid)}</span>
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className="sticky right-0 z-[4] flex h-full min-w-0 items-center whitespace-nowrap bg-[var(--graph-row-background)] pr-3 text-[.85rem] text-muted-foreground"
          aria-label={`Commit date ${formattedDate}`}
        >
          <time className="truncate" dateTime={date.toISOString()}>
            {shownDate}
          </time>
        </td>
      </>
    );
  },
  (previous, next) =>
    previous.commit === next.commit &&
    previous.labels === next.labels &&
    previous.graph === next.graph &&
    previous.order === next.order,
);

const currentYear = new Date().getFullYear();

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});

const monthFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short",
  year: "numeric",
});

function shortOid(oid: string) {
  return oid.slice(0, 8);
}
