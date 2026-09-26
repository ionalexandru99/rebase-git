import type { ConflictSide, ConflictSides } from "@rebase/contracts";
import { IconArrowBarToDown } from "@tabler/icons-react";
import { memo, type RefObject, useMemo, useState } from "react";
import { Button } from "#web/components/ui/button";
import {
  paneRows,
  type RegionBand,
  type SideSegment,
  sideSegments,
} from "#web/features/merge-view/aligned-rows";
import {
  bandEdges,
  PaneLines,
  type PaneProps,
  sideNames,
} from "#web/features/merge-view/components/pane-lines";
import type { MergeModel } from "#web/features/merge-view/conflict-document";
import {
  type LineSelection,
  sideTaken,
} from "#web/features/merge-view/hooks/use-selection";
import { cn } from "#web/lib/utils";

const sideShortcuts: Partial<Record<ConflictSide, string>> = {
  current: "Alt+1",
  incoming: "Alt+2",
};

const takenHunks: Record<ConflictSide, string> = {
  base: "aria-pressed:bg-muted-foreground",
  current: "aria-pressed:bg-[#69b1ff]",
  incoming: "aria-pressed:bg-[#5ecc71]",
};

interface PanesProps {
  readonly sides: ConflictSides;
  readonly leftSide: ConflictSide;
  readonly activeRegion: string | null;
  readonly lines: LineSelection;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
}

export function SidePanes({
  model,
  ...props
}: PanesProps & { readonly model: MergeModel }) {
  return <AlignedPanes segments={useSideSegments(model)} {...props} />;
}

function useSideSegments(model: MergeModel) {
  const [segments, setSegments] = useState<readonly SideSegment[]>([]);
  const next = sideSegments(model, segments);
  if (next !== segments) setSegments(next);
  return next;
}

const AlignedPanes = memo(function AlignedPanes({
  segments,
  sides,
  leftSide,
  activeRegion,
  lines,
  scrollRef,
}: PanesProps & { readonly segments: readonly SideSegment[] }) {
  const rows = useMemo(
    () => paneRows(segments, leftSide, "incoming"),
    [segments, leftSide],
  );
  const left: PaneProps = {
    side: leftSide,
    activeRegion,
    lines,
    rows: rows.left,
  };
  const right: PaneProps = {
    side: "incoming",
    activeRegion,
    lines,
    rows: rows.right,
  };
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

function HunkGutter({ rows, side, activeRegion, lines }: PaneProps) {
  return (
    <div className="w-7 shrink-0 bg-muted/40 select-none">
      {rows.map((row) => (
        <div
          key={row.key}
          className={cn(
            "flex h-5 items-center justify-center",
            row.kind !== "context" && bandEdges(row.band, activeRegion),
          )}
        >
          {row.kind !== "context" &&
            row.band.first &&
            row.band.segment.region[side].length > 0 && (
              <HunkButton
                band={row.band}
                side={side}
                active={row.band.segment.region.id === activeRegion}
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
  active,
  lines,
}: {
  readonly band: RegionBand;
  readonly side: ConflictSide;
  readonly active: boolean;
  readonly lines: LineSelection;
}) {
  const { region, picks } = band.segment;
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Take ${sideNames[side].toLowerCase()}, region ${band.ordinal}`}
      aria-pressed={sideTaken(picks, region, side)}
      aria-keyshortcuts={active ? sideShortcuts[side] : undefined}
      className={cn(
        "size-5 border-border bg-background text-muted-foreground aria-pressed:border-transparent aria-pressed:text-background sm:size-5",
        takenHunks[side],
      )}
      onClick={() => lines.take(region, side)}
    >
      <IconArrowBarToDown aria-hidden="true" className="size-3.5" />
    </Button>
  );
}
