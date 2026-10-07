import type { RepositoryHistoryRefTarget } from "#contracts/repository-history/repository-history.contract.ts";
import {
  HorizontalScrollButton,
  horizontalScrollViewport,
  useHorizontalScroll,
} from "#web/components/ui/horizontal-scroll.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#web/components/ui/popover.tsx";
import { CommitRefLabels } from "#web/features/commit-graph/components/commit-ref-labels.tsx";
import { graphMetadataWidth } from "#web/features/commit-graph/layout/graph-geometry.ts";

export function CommitMessage({
  subject,
  labels,
  order,
}: {
  readonly subject: string;
  readonly labels: readonly RepositoryHistoryRefTarget[];
  readonly order: number;
}) {
  const { viewport, content, edges, measure, scroll, onKeyDown } =
    useHorizontalScroll();
  return (
    <>
      <div className="relative z-[2] h-full min-w-0">
        <section
          ref={viewport}
          className={`${horizontalScrollViewport} ${edges.room ? "" : "invisible"}`}
          inert={!edges.room}
          onScroll={measure}
          aria-label={`Commit message ${subject}`}
          tabIndex={edges.room && (edges.left || edges.right) ? 0 : -1}
          onKeyDown={onKeyDown}
        >
          <div
            ref={content}
            className="flex h-full w-max items-center gap-2 whitespace-nowrap pr-6"
          >
            {order > 0 ? (
              <span className="grid h-4 min-w-4 shrink-0 place-items-center rounded-control bg-primary/25 px-1 font-mono text-[10px] font-semibold">
                {order}
              </span>
            ) : null}
            <span className="shrink-0">{subject}</span>
            <CommitRefLabels labels={labels} />
          </div>
        </section>
        {edges.room && edges.left ? (
          <HorizontalScrollButton
            direction={-1}
            label="Scroll message left"
            background="bg-[var(--graph-row-background)]"
            onScroll={scroll}
          />
        ) : null}
        {edges.room && edges.right ? (
          <HorizontalScrollButton
            direction={1}
            label="Scroll message right"
            background="bg-[var(--graph-row-background)]"
            onScroll={scroll}
          />
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
