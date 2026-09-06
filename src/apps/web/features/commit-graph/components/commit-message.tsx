import type { RepositoryHistoryRefTarget } from "@rebase/contracts";
import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import { useCommitMessageScroll } from "#web/features/commit-graph/hooks/use-commit-message-scroll";
import { graphMetadataWidth } from "#web/features/commit-graph/layout/graph-metrics";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#web-ui/components/ui/popover";
import { CommitRefLabels } from "#web-ui/features/commit-graph/components/commit-ref-labels";

export function CommitMessage({
  subject,
  labels,
}: {
  readonly subject: string;
  readonly labels: readonly RepositoryHistoryRefTarget[];
}) {
  const { viewport, content, edges, measure, scroll } =
    useCommitMessageScroll();
  return (
    <>
      <div className="relative z-[2] h-full min-w-0">
        <section
          ref={viewport}
          className={`h-full overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${edges.room ? "" : "invisible"}`}
          inert={!edges.room}
          onScroll={measure}
          aria-label={`Commit message ${subject}`}
          tabIndex={edges.room && (edges.left || edges.right) ? 0 : -1}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Home" || event.key === "End")
              event.currentTarget.scrollLeft =
                event.key === "Home" ? 0 : event.currentTarget.scrollWidth;
            else scroll(event.key === "ArrowLeft" ? -1 : 1);
          }}
        >
          <div
            ref={content}
            className="flex h-full w-max items-center gap-2 whitespace-nowrap pr-6"
          >
            <span className="shrink-0">{subject}</span>
            <CommitRefLabels labels={labels} />
          </div>
        </section>
        {edges.room && edges.left ? (
          <button
            type="button"
            aria-label="Scroll message left"
            className="absolute inset-y-0 left-0 z-[3] w-5 bg-[var(--graph-row-background)] text-muted-foreground"
            onClick={(event) => {
              event.stopPropagation();
              scroll(-1);
            }}
          >
            <IconChevronLeft aria-hidden="true" className="size-3" />
          </button>
        ) : null}
        {edges.room && edges.right ? (
          <button
            type="button"
            aria-label="Scroll message right"
            className="absolute inset-y-0 right-0 z-[3] w-5 bg-[var(--graph-row-background)] text-muted-foreground"
            onClick={(event) => {
              event.stopPropagation();
              scroll(1);
            }}
          >
            <IconChevronRight aria-hidden="true" className="size-3" />
          </button>
        ) : null}
      </div>
      {edges.room ? null : (
        <Popover>
          <PopoverTrigger
            className="absolute inset-y-0 z-[3] bg-[var(--graph-row-background)] px-2 text-[.85rem] text-muted-foreground"
            style={{ right: graphMetadataWidth }}
            onClick={(event) => event.stopPropagation()}
            aria-label="Show message hidden by wide graph"
          >
            More ›
          </PopoverTrigger>
          <PopoverContent
            className="max-w-[calc(100vw-24px)]"
            aria-label="Commit message"
          >
            <p className="mb-3 break-words text-[.85rem]">{subject}</p>
            <div className="overflow-x-auto">
              <CommitRefLabels labels={labels} />
            </div>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}
