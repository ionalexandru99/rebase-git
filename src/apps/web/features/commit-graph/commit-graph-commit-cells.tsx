import type { RepositoryCommit } from "@rebase/contracts";
import { type ComponentProps, memo } from "react";
import { CommitRefLabels } from "#web-ui/features/commit-graph/commit-ref-labels";

export const CommitGraphCommitCells = memo(
  function CommitGraphCommitCells({
    commit,
    labels,
    context,
    registry,
    execute,
    restoreFocus,
  }: ComponentProps<typeof CommitRefLabels> & {
    readonly commit: RepositoryCommit;
  }) {
    const date = new Date(commit.committer.timestampSeconds * 1_000);
    const formattedDate = dateFormatter.format(date);
    return (
      <>
        <td
          role="gridcell"
          tabIndex={-1}
          aria-label={`${commit.parents.length} parents`}
        />
        <td
          role="gridcell"
          tabIndex={-1}
          className="flex min-w-0 items-center gap-2 pr-4"
        >
          <span className="min-w-16 truncate" title={commit.subject}>
            {commit.subject}
          </span>
          <CommitRefLabels
            key={commit.oid}
            labels={labels}
            context={context}
            registry={registry}
            execute={execute}
            restoreFocus={restoreFocus}
          />
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className="truncate pr-3 font-mono text-[11px] text-muted-foreground"
          aria-label={`Commit SHA ${commit.oid}`}
          title={commit.oid}
        >
          {shortOid(commit.oid)}
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className="truncate pr-4 text-muted-foreground"
          aria-label={`Author ${commit.author.name}`}
          title={commit.author.name}
        >
          {commit.author.name}
        </td>
        <td
          role="gridcell"
          tabIndex={-1}
          className="truncate pr-3 text-muted-foreground"
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
