import type { ConflictSide, ConflictSides, TokenMark } from "@rebase/contracts";
import { memo, type RefObject, useMemo } from "react";
import { LineBox } from "#web/features/merge-view/components/line-box";
import type { LineSelection } from "#web/features/merge-view/hooks/use-line-selection";
import {
  type PaneRow,
  paneRows,
  type RegionBand,
  type SideSegment,
} from "#web/features/merge-view/pane-rows";
import {
  sideMarks,
  sideNames,
  sideRows,
} from "#web/features/merge-view/side-styles";
import { cn } from "#web/lib/utils";

interface PaneProps {
  readonly rows: readonly PaneRow[];
  readonly side: ConflictSide;
  readonly activeRegion: string | null;
}

export const SidePanes = memo(function SidePanes({
  segments,
  sides,
  leftSide,
  activeRegion,
  selection,
  onRegionClick,
  scrollRef,
}: {
  readonly segments: readonly SideSegment[];
  readonly sides: ConflictSides;
  readonly leftSide: ConflictSide;
  readonly activeRegion: string | null;
  readonly selection: LineSelection;
  readonly onRegionClick: (regionId: string) => void;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const rows = useMemo(
    () => paneRows(segments, leftSide, "incoming"),
    [segments, leftSide],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 border-border border-b">
        <PaneHeader side={leftSide} sides={sides} className="pl-9" />
        <PaneHeader side="incoming" sides={sides} className="pr-9" />
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
      >
        <div className="flex font-mono text-xs leading-5">
          <LineGutter
            rows={rows.left}
            side={leftSide}
            activeRegion={activeRegion}
            selection={selection}
            onRegionClick={onRegionClick}
          />
          <PaneText
            rows={rows.left}
            side={leftSide}
            activeRegion={activeRegion}
            onRegionClick={onRegionClick}
          />
          <PaneText
            rows={rows.right}
            side="incoming"
            activeRegion={activeRegion}
            onRegionClick={onRegionClick}
          />
          <LineGutter
            rows={rows.right}
            side="incoming"
            activeRegion={activeRegion}
            selection={selection}
            onRegionClick={onRegionClick}
          />
        </div>
      </div>
    </div>
  );
});

function PaneHeader({
  side,
  sides,
  className,
}: {
  readonly side: ConflictSide;
  readonly sides: ConflictSides;
  readonly className: string;
}) {
  const { ref, commit, subject } = sides[side];
  return (
    <div
      className={cn(
        "flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-xs",
        className,
      )}
    >
      <strong className="shrink-0 font-semibold">{sideNames[side]}</strong>
      <span className="shrink-0 font-mono text-muted-foreground">
        {commit === null ? ref : commit.slice(0, 7)}
      </span>
      <span className="min-w-0 truncate text-muted-foreground">{subject}</span>
    </div>
  );
}

function LineGutter({
  rows,
  side,
  activeRegion,
  selection,
  onRegionClick,
}: PaneProps & {
  readonly selection: LineSelection;
  readonly onRegionClick: (regionId: string) => void;
}) {
  const first = rows.findIndex(({ kind }) => kind === "line");
  return (
    <div data-gutter={side} className="w-7 shrink-0 bg-muted/40 select-none">
      {rows.map((row, index) => (
        <div
          key={row.key}
          className={cn(
            "flex h-5 items-center justify-center",
            row.kind !== "context" && bandEdges(row.band, activeRegion),
          )}
        >
          {row.kind === "line" && (
            <LineBox
              target={{
                regionId: row.band.segment.region.id,
                side,
                index: row.index,
              }}
              picks={row.band.segment.picks}
              lineCount={row.band.segment.region[side].length}
              ordinal={row.band.ordinal}
              focusable={index === first}
              selection={selection}
              onFocus={onRegionClick}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function PaneText({
  rows,
  side,
  activeRegion,
  onRegionClick,
}: PaneProps & { readonly onRegionClick: (regionId: string) => void }) {
  return (
    <div
      data-pane={side}
      className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
      onPointerDown={(event) => {
        const regionId = (event.target as HTMLElement).closest<HTMLElement>(
          "[data-region]",
        )?.dataset.region;
        if (regionId !== undefined) onRegionClick(regionId);
      }}
    >
      <div className="w-max min-w-full">
        {rows.map((row) => (
          <div
            key={row.key}
            data-row={row.kind}
            data-region={
              row.kind === "context" ? undefined : row.band.segment.region.id
            }
            className={cn(
              "h-5 px-2 whitespace-pre",
              row.kind === "line" && sideRows[side],
              row.kind === "padding" && "bg-muted/30",
              row.kind !== "context" && bandEdges(row.band, activeRegion),
              row.kind === "line" &&
                picked(row.band, side, row.index) &&
                "outline -outline-offset-1 outline-foreground/20",
            )}
          >
            {row.kind === "context" ? (
              row.text
            ) : row.kind === "line" ? (
              <MarkedLine
                text={row.text}
                marks={lineMarks(row.band, side, row.index)}
                markClass={sideMarks[side]}
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function MarkedLine({
  text,
  marks,
  markClass,
}: {
  readonly text: string;
  readonly marks: readonly TokenMark[];
  readonly markClass: string;
}) {
  if (marks.length === 0) return text;
  const parts: { text: string; marked: boolean; start: number }[] = [];
  let cursor = 0;
  for (const { start, end } of [...marks].sort((a, b) => a.start - b.start)) {
    if (start < cursor) continue;
    if (start > cursor)
      parts.push({
        text: text.slice(cursor, start),
        marked: false,
        start: cursor,
      });
    parts.push({ text: text.slice(start, end), marked: true, start });
    cursor = end;
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), marked: false, start: cursor });
  return parts.map((part) =>
    part.marked ? (
      <mark
        key={part.start}
        className={cn("rounded-[2px] text-inherit", markClass)}
      >
        {part.text}
      </mark>
    ) : (
      <span key={part.start}>{part.text}</span>
    ),
  );
}

function lineMarks(band: RegionBand, side: ConflictSide, index: number) {
  if (side === "base") return [];
  return band.segment.region.marks[side].filter(({ line }) => line === index);
}

function picked(band: RegionBand, side: ConflictSide, index: number) {
  return band.segment.picks.some(
    (pick) => pick.side === side && pick.index === index,
  );
}

function bandEdges(band: RegionBand, activeRegion: string | null) {
  return cn(
    band.first && "border-t",
    band.last && "border-b",
    band.segment.region.id === activeRegion
      ? "border-status-connecting/70"
      : "border-border",
  );
}
