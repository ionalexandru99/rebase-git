import type { RepositoryCommit } from "@rebase/contracts";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef } from "react";

export function HistorySearchResults({
  commits,
  selected,
  navigating,
  onNavigate,
  onLoadMore,
}: {
  readonly commits: readonly RepositoryCommit[];
  readonly selected: number;
  readonly navigating: boolean;
  readonly onNavigate: (index: number) => void;
  readonly onLoadMore: () => void;
}) {
  const viewport = useRef<HTMLElement>(null);
  const rows = useVirtualizer({
    count: commits.length,
    getScrollElement: () => viewport.current,
    getItemKey: (index) => commits[index]?.oid ?? index,
    estimateSize: () => 72,
    overscan: 3,
  });
  useEffect(() => {
    if (selected >= 0) rows.scrollToIndex(selected, { align: "auto" });
  }, [selected, rows]);
  const loadNearEnd = () => {
    const element = viewport.current;
    if (
      element !== null &&
      element.scrollTop + element.clientHeight >= element.scrollHeight - 80
    )
      onLoadMore();
  };
  return (
    <section
      ref={viewport}
      aria-label="Search matches"
      className="max-h-[min(24rem,60vh)] overflow-y-auto overscroll-contain p-1"
      onScroll={loadNearEnd}
      onWheel={(event) => {
        if (event.deltaY > 0) loadNearEnd();
      }}
    >
      <div className="relative w-full" style={{ height: rows.getTotalSize() }}>
        {rows.getVirtualItems().map((row) => {
          const commit = commits[row.index];
          if (commit === undefined) return null;
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={rows.measureElement}
              className="absolute top-0 left-0 w-full"
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <button
                type="button"
                aria-current={selected === row.index ? "true" : undefined}
                className="flex w-full flex-col gap-1 rounded-sm px-2 py-2 text-left text-[.85rem] leading-5 outline-none hover:bg-accent focus-visible:bg-accent disabled:opacity-50 aria-current:bg-accent"
                disabled={navigating}
                onClick={() => onNavigate(row.index)}
              >
                <span className="w-full whitespace-normal [overflow-wrap:anywhere]">
                  {commit.subject}
                </span>
                <span className="flex w-full flex-wrap items-start gap-x-3 text-muted-foreground">
                  <span className="min-w-0 flex-1 whitespace-normal [overflow-wrap:anywhere]">
                    {commit.author.name} · {commit.author.email}
                  </span>
                  <span className="shrink-0">{commit.oid.slice(0, 8)}</span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
