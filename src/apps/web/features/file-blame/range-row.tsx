import { IconArrowUpRight, IconPencil } from "@tabler/icons-react";
import type { BlameCommit } from "#contracts/file-blame/file-blame.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { AuthorAvatar } from "#web/features/author-avatars/author-avatar.tsx";
import { dateLabel } from "#web/features/file-history/file-history-list.tsx";

export function RangeRow({
  id,
  index,
  commit,
  selected,
  onOpen,
}: {
  readonly id: string;
  readonly index: number;
  readonly commit: BlameCommit | undefined;
  readonly selected: boolean;
  readonly onOpen: () => void;
}) {
  return (
    <div
      aria-selected={selected}
      className={`flex h-6 w-(--blame-row) cursor-default items-center gap-2 border-border/70 border-t pr-1 pl-2 font-sans text-meta select-none ${
        selected
          ? "bg-primary/15 text-foreground"
          : "bg-(--repository) text-muted-foreground"
      }`}
      data-range={index}
      id={id}
      role="option"
      tabIndex={-1}
    >
      {commit === undefined ? (
        <>
          <IconPencil
            aria-hidden="true"
            className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
          />
          <span className="min-w-0 flex-1 truncate text-amber-600 dark:text-amber-400">
            Uncommitted
          </span>
        </>
      ) : (
        <>
          <AuthorAvatar
            commit={{
              oid: commit.oid,
              author: { name: commit.author, email: commit.email },
            }}
          />
          <span className="min-w-0 flex-1 truncate">{commit.subject}</span>
          <span className="shrink-0 tabular-nums">
            {dateLabel(commit.authoredAt)}
          </span>
        </>
      )}
      {selected ? (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={commit === undefined ? "Open in Diffs" : "Open commit"}
          className="-my-1 size-5"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
        >
          <IconArrowUpRight />
        </Button>
      ) : null}
    </div>
  );
}
