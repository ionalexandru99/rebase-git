import { IconArrowBarToDown } from "@tabler/icons-react";
import { memo, type RefObject, useMemo } from "react";
import type {
  ConflictSide,
  ConflictSides,
} from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import {
  bandEdges,
  PaneLines,
  type PaneProps,
  type PaneRow,
  type RegionBand,
  sideColours,
  sideNames,
} from "#web/features/merge-view/components/pane-lines.tsx";
import {
  type MergeModel,
  picksOf,
  sideTaken,
} from "#web/features/merge-view/conflict-document.ts";
import type { LineSelection } from "#web/features/merge-view/hooks/use-selection.ts";
import { cn } from "#web/lib/utils.ts";

const sideShortcuts: Partial<Record<ConflictSide, string>> = {
  current: "Alt+1",
  incoming: "Alt+2",
};

export const SidePanes = memo(function SidePanes({
  loaded,
  sides,
  leftSide,
  scrollRef,
  ...shared
}: Omit<PaneProps, "rows" | "side"> & {
  readonly loaded: MergeModel;
  readonly sides: ConflictSides;
  readonly leftSide: ConflictSide;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const rows = useMemo(() => paneRows(loaded, leftSide), [loaded, leftSide]);
  const left: PaneProps = { ...shared, side: leftSide, rows: rows.left };
  const right: PaneProps = { ...shared, side: "incoming", rows: rows.right };
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
          <HunkGutter {...left} />
          <PaneLines {...left} />
          <PaneLines {...right} />
          <HunkGutter {...right} />
        </div>
      </div>
    </div>
  );
});

function paneRows(model: MergeModel, leftSide: ConflictSide) {
  const left: PaneRow[] = [];
  const right: PaneRow[] = [];
  let ordinal = 0;
  for (const segment of model.segments) {
    if (segment.kind === "text") {
      for (const text of segment.lines) {
        const key = `line-${left.length}`;
        left.push({ kind: "context", key, text });
        right.push({ kind: "context", key, text });
      }
      continue;
    }
    ordinal += 1;
    const { region } = segment;
    const height = Math.max(region[leftSide].length, region.incoming.length, 1);
    for (let index = 0; index < height; index += 1) {
      const band = {
        region,
        ordinal,
        first: index === 0,
        last: index === height - 1,
      };
      left.push(bandRow(band, leftSide, index));
      right.push(bandRow(band, "incoming", index));
    }
  }
  return { left, right };
}

function bandRow(band: RegionBand, side: ConflictSide, index: number): PaneRow {
  const text = band.region[side][index];
  const key = `${band.region.id}-${index}`;
  return text === undefined
    ? { kind: "padding", key, band }
    : { kind: "line", key, band, side, index, text };
}

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

function HunkGutter({ rows, side, picks, activeRegion, lines }: PaneProps) {
  return (
    <div className="w-7 shrink-0 bg-muted/40 select-none">
      {rows.map((row) => (
        <div
          key={row.key}
          data-region={
            row.kind !== "context" && row.band.first
              ? row.band.region.id
              : undefined
          }
          className={cn(
            "flex h-5 items-center justify-center",
            row.kind !== "context" && bandEdges(row.band, activeRegion),
          )}
        >
          {row.kind !== "context" &&
            row.band.first &&
            row.band.region[side].length > 0 && (
              <HunkButton
                band={row.band}
                side={side}
                taken={sideTaken(
                  picksOf(picks, row.band.region.id),
                  row.band.region,
                  side,
                )}
                active={row.band.region.id === activeRegion}
                lines={lines}
              />
            )}
        </div>
      ))}
    </div>
  );
}

function HunkButton({
  band,
  side,
  taken,
  active,
  lines,
}: {
  readonly band: RegionBand;
  readonly side: ConflictSide;
  readonly taken: boolean;
  readonly active: boolean;
  readonly lines: LineSelection;
}) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Take ${sideNames[side].toLowerCase()}, region ${band.ordinal}`}
      aria-pressed={taken}
      aria-keyshortcuts={active ? sideShortcuts[side] : undefined}
      className={cn(
        "size-5 border-border bg-background text-muted-foreground sm:size-5",
        taken && ["border-transparent text-background", sideColours[side].edge],
      )}
      onClick={() => lines.take(band.region, side)}
    >
      <IconArrowBarToDown aria-hidden="true" className="size-3.5" />
    </Button>
  );
}
