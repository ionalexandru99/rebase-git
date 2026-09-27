import type {
  ConflictRegion,
  ConflictSide,
  TokenMark,
} from "@rebase/contracts";
import type { KeyboardEvent } from "react";
import {
  type LinePick,
  type Picks,
  pickPosition,
  picksOf,
} from "#web/features/merge-view/conflict-document";
import type {
  LineSelection,
  LineTarget,
} from "#web/features/merge-view/hooks/use-selection";
import { cn } from "#web/lib/utils";

export const sideNames: Record<ConflictSide, string> = {
  base: "Base",
  current: "Current",
  incoming: "Incoming",
};

export const sideColours: Record<
  ConflictSide,
  {
    readonly tint: string;
    readonly picked: string;
    readonly mark: string;
    readonly edge: string;
  }
> = {
  base: {
    tint: "bg-muted",
    picked:
      "bg-muted-foreground/25 shadow-[inset_3px_0_0_var(--muted-foreground)]",
    mark: "bg-muted-foreground/30",
    edge: "bg-muted-foreground",
  },
  current: {
    tint: "bg-primary/10",
    picked: "bg-primary/25 shadow-[inset_3px_0_0_var(--primary)]",
    mark: "bg-primary/35",
    edge: "bg-primary",
  },
  incoming: {
    tint: "bg-status-available/10",
    picked:
      "bg-status-available/25 shadow-[inset_3px_0_0_var(--status-available)]",
    mark: "bg-status-available/35",
    edge: "bg-status-available",
  },
};

export interface RegionBand {
  readonly region: ConflictRegion;
  readonly ordinal: number;
  readonly first: boolean;
  readonly last: boolean;
}

export type PaneRow =
  | { readonly kind: "context"; readonly key: string; readonly text: string }
  | {
      readonly kind: "line";
      readonly key: string;
      readonly band: RegionBand;
      readonly side: ConflictSide;
      readonly index: number;
      readonly text: string;
    }
  | {
      readonly kind: "padding";
      readonly key: string;
      readonly band: RegionBand;
    };

export interface PaneProps {
  readonly rows: readonly PaneRow[];
  readonly side: ConflictSide;
  readonly picks: Picks;
  readonly activeRegion: string | null;
  readonly lines: LineSelection;
}

export function PaneLines({
  rows,
  side,
  picks,
  activeRegion,
  lines,
}: PaneProps) {
  const first = rows.findIndex(({ kind }) => kind === "line");
  return (
    <div
      data-pane={side}
      className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
    >
      <div className="w-max min-w-full">
        {rows.map((row, index) =>
          row.kind === "line" ? (
            <LineRow
              key={row.key}
              row={row}
              picks={picksOf(picks, row.band.region.id)}
              focusable={index === first}
              activeRegion={activeRegion}
              lines={lines}
            />
          ) : (
            <div
              key={row.key}
              data-row={row.kind}
              className={cn(
                "h-5 px-2 whitespace-pre",
                row.kind === "padding" && "bg-muted/30",
                row.kind !== "context" && bandEdges(row.band, activeRegion),
              )}
            >
              {row.kind === "context" ? row.text : null}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function LineRow({
  row,
  picks,
  focusable,
  activeRegion,
  lines,
}: {
  readonly row: Extract<PaneRow, { kind: "line" }>;
  readonly picks: readonly LinePick[];
  readonly focusable: boolean;
  readonly activeRegion: string | null;
  readonly lines: LineSelection;
}) {
  const { band, side, index } = row;
  const { region } = band;
  const target = { regionId: region.id, side, index };
  const selected = pickPosition(picks, target) !== -1;
  const colours = sideColours[side];
  return (
    <button
      type="button"
      data-row="line"
      aria-pressed={selected}
      aria-label={`${sideNames[side]} line ${index + 1}, region ${band.ordinal}`}
      tabIndex={focusable ? 0 : -1}
      className={cn(
        "block h-5 w-full cursor-default px-2 text-left whitespace-pre outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
        selected ? colours.picked : colours.tint,
        bandEdges(band, activeRegion),
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        lines.press(target, picks);
      }}
      onPointerEnter={(event) => lines.enter(target, event.buttons)}
      onFocus={() => lines.focusRegion(region.id)}
      onClick={(event) => {
        if (event.detail === 0) lines.toggle(target);
      }}
      onKeyDown={(event) => moveWithKeys(event, target, region, lines)}
    >
      <MarkedLine
        text={row.text}
        marks={
          side === "base"
            ? []
            : region.marks[side].filter(({ line }) => line === index)
        }
        markClass={selected ? "bg-foreground/20" : colours.mark}
      />
    </button>
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
  for (const { start, end } of marks) {
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

function moveWithKeys(
  event: KeyboardEvent<HTMLButtonElement>,
  target: LineTarget,
  region: ConflictRegion,
  lines: LineSelection,
) {
  if (event.altKey || (event.key !== "ArrowDown" && event.key !== "ArrowUp"))
    return;
  event.preventDefault();
  const direction = event.key === "ArrowDown" ? 1 : -1;
  const rows = [
    ...(event.currentTarget
      .closest("[data-pane]")
      ?.querySelectorAll<HTMLElement>('[data-row="line"]') ?? []),
  ];
  const next = rows[rows.indexOf(event.currentTarget) + direction];
  if (!event.shiftKey) return next?.focus();
  const index = target.index + direction;
  if (index < 0 || index >= region[target.side].length) return;
  lines.extend(target, index);
  next?.focus();
}

export function bandEdges(band: RegionBand, activeRegion: string | null) {
  return cn(
    band.first && "border-t",
    band.last && "border-b",
    band.region.id === activeRegion ? "border-foreground/30" : "border-border",
  );
}
