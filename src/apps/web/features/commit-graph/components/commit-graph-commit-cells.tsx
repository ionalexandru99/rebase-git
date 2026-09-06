import type {
  RepositoryCommit,
  RepositoryHistoryRefTarget,
} from "@rebase/contracts";
import { memo, type ReactNode } from "react";
import { AuthorAvatar } from "#web/features/author-avatars/index";
import { CommitMessage } from "#web-ui/features/commit-graph/components/commit-message";

export const CommitGraphCommitCells = memo(
  function CommitGraphCommitCells({
    commit,
    labels,
    graph,
  }: {
    readonly labels: readonly RepositoryHistoryRefTarget[];
    readonly commit: RepositoryCommit;
    readonly graph?: ReactNode;
  }) {
    const date = new Date(commit.committer.timestampSeconds * 1_000);
    const formattedDate = dateFormatter.format(date);
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
          />
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className="sticky right-[190px] z-[4] flex h-full min-w-0 items-center gap-1.5 bg-[var(--graph-row-background)] px-3 text-muted-foreground"
          aria-label={`Author ${commit.author.name}`}
        >
          <AuthorAvatar commit={commit} />
          <span className="truncate">{commit.author.name}</span>
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className="sticky right-28 z-[4] flex h-full items-center bg-[var(--graph-row-background)] pr-3 font-sans text-[.85rem] text-muted-foreground"
          aria-label={`Commit SHA ${commit.oid}`}
        >
          {shortOid(commit.oid)}
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className="sticky right-0 z-[4] flex h-full items-center whitespace-nowrap bg-[var(--graph-row-background)] pr-3 text-[.85rem] text-muted-foreground"
          aria-label={`Commit date ${formattedDate}`}
        >
          <time dateTime={date.toISOString()}>{formattedDate}</time>
        </td>
      </>
    );
  },
  (previous, next) =>
    previous.commit === next.commit &&
    previous.labels === next.labels &&
    previous.graph === next.graph,
);

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function shortOid(oid: string) {
  return oid.slice(0, 8);
}
