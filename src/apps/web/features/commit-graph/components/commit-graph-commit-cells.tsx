import type { RepositoryCommit } from "@rebase/contracts";
import { type ComponentProps, memo, type ReactNode } from "react";
import { AuthorAvatar } from "#web/features/author-avatars/index";
import { CommitRefLabels } from "#web-ui/features/commit-graph/components/commit-ref-labels";

export const CommitGraphCommitCells = memo(
  function CommitGraphCommitCells({
    commit,
    labels,
    context,
    registry,
    execute,
    restoreFocus,
    colors,
    graph,
  }: ComponentProps<typeof CommitRefLabels> & {
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
        <td
          role="gridcell"
          tabIndex={-1}
          className="relative z-[2] flex h-full min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap"
        >
          <span className="shrink-0" title={commit.subject}>
            {commit.subject}
          </span>
          <CommitRefLabels
            key={commit.oid}
            labels={labels}
            context={context}
            registry={registry}
            execute={execute}
            restoreFocus={restoreFocus}
            colors={colors}
          />
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className="sticky right-[190px] z-[4] flex h-full min-w-0 items-center gap-1.5 bg-[var(--graph-row-background)] px-3 text-muted-foreground"
          aria-label={`Author ${commit.author.name}`}
          title={commit.author.name}
        >
          <AuthorAvatar commit={commit} />
          <span className="truncate">{commit.author.name}</span>
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className="sticky right-28 z-[4] flex h-full items-center bg-[var(--graph-row-background)] pr-3 font-mono text-[11px] text-muted-foreground"
          aria-label={`Commit SHA ${commit.oid}`}
          title={commit.oid}
        >
          {shortOid(commit.oid)}
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className="sticky right-0 z-[4] flex h-full items-center whitespace-nowrap bg-[var(--graph-row-background)] pr-3 text-[11px] text-muted-foreground"
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
    previous.colors === next.colors &&
    previous.graph === next.graph &&
    (next.labels.length === 0 ||
      (previous.context === next.context &&
        previous.registry === next.registry &&
        previous.execute === next.execute &&
        previous.restoreFocus === next.restoreFocus)),
);

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function shortOid(oid: string) {
  return oid.slice(0, 8);
}
