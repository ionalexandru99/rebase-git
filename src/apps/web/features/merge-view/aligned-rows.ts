import type { ConflictRegion, ConflictSide } from "@rebase/contracts";
import {
  choicePicks,
  type LinePick,
  type MergeModel,
  type TextSegment,
} from "#web/features/merge-view/conflict-document";

export interface SideRegion {
  readonly kind: "region";
  readonly region: ConflictRegion;
  readonly picks: readonly LinePick[];
}

export type SideSegment = TextSegment | SideRegion;

export interface RegionBand {
  readonly segment: SideRegion;
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

export interface PaneRows {
  readonly left: readonly PaneRow[];
  readonly right: readonly PaneRow[];
}

export function sideSegments(
  model: MergeModel,
  previous: readonly SideSegment[],
): readonly SideSegment[] {
  const next = model.segments.map((segment, index): SideSegment => {
    if (segment.kind === "text") return segment;
    const picks = choicePicks(segment.choice);
    const known = previous[index];
    return known?.kind === "region" &&
      known.region === segment.region &&
      known.picks === picks
      ? known
      : { kind: "region", region: segment.region, picks };
  });
  return next.length === previous.length &&
    next.every((segment, index) => segment === previous[index])
    ? previous
    : next;
}

export function paneRows(
  segments: readonly SideSegment[],
  leftSide: ConflictSide,
  rightSide: ConflictSide,
): PaneRows {
  const left: PaneRow[] = [];
  const right: PaneRow[] = [];
  let ordinal = 0;
  for (const segment of segments) {
    if (segment.kind === "text") {
      for (const text of segment.lines) {
        const key = `line-${left.length}`;
        left.push({ kind: "context", key, text });
        right.push({ kind: "context", key, text });
      }
      continue;
    }
    ordinal += 1;
    const height = bandHeight(segment.region, leftSide, rightSide);
    for (let index = 0; index < height; index += 1) {
      const band = {
        segment,
        ordinal,
        first: index === 0,
        last: index === height - 1,
      };
      left.push(bandRow(band, leftSide, index));
      right.push(bandRow(band, rightSide, index));
    }
  }
  return { left, right };
}

export function regionRowOffset(
  model: MergeModel,
  regionId: string,
  leftSide: ConflictSide,
  rightSide: ConflictSide,
) {
  let row = 0;
  for (const segment of model.segments) {
    if (segment.kind === "region" && segment.region.id === regionId) return row;
    row +=
      segment.kind === "text"
        ? segment.lines.length
        : bandHeight(segment.region, leftSide, rightSide);
  }
  return null;
}

function bandHeight(
  region: ConflictRegion,
  leftSide: ConflictSide,
  rightSide: ConflictSide,
) {
  return Math.max(region[leftSide].length, region[rightSide].length, 1);
}

function bandRow(band: RegionBand, side: ConflictSide, index: number): PaneRow {
  const text = band.segment.region[side][index];
  const key = `${band.segment.region.id}-${index}`;
  return text === undefined
    ? { kind: "padding", key, band }
    : { kind: "line", key, band, side, index, text };
}
