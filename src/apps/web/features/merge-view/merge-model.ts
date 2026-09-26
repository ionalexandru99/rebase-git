import type {
  ConflictDocument,
  ConflictRegion,
  ConflictSide,
} from "@rebase/contracts";
import { markerBlocks } from "#web/features/merge-view/marker-blocks";

export interface LinePick {
  readonly side: ConflictSide;
  readonly index: number;
}

export type RegionChoice =
  | { readonly kind: "open" }
  | { readonly kind: "picked"; readonly picks: readonly LinePick[] }
  | {
      readonly kind: "edited";
      readonly picks: readonly LinePick[];
      readonly lines: readonly string[];
    };

export interface RegionSegment {
  readonly kind: "region";
  readonly region: ConflictRegion;
  readonly marker: readonly string[];
  readonly choice: RegionChoice;
}

export interface TextSegment {
  readonly kind: "text";
  readonly lines: readonly string[];
}

export type MergeSegment = TextSegment | RegionSegment;

export interface MergeModel {
  readonly eol: "\n" | "\r\n";
  readonly segments: readonly MergeSegment[];
  readonly regionCount: number;
}

interface Anchor {
  readonly start: number;
  readonly length: number;
  readonly segment: RegionSegment;
}

export function mergeModel(document: ConflictDocument): MergeModel {
  const eol = document.content.includes("\r\n") ? "\r\n" : "\n";
  const lines = document.content.split(eol);
  const anchors = [
    ...openAnchors(document, lines),
    ...decidedAnchors(document, lines),
  ].sort((left, right) => left.start - right.start);
  return {
    eol,
    segments: placeAnchors(lines, anchors),
    regionCount: document.regions.length,
  };
}

export function segmentLines(segment: MergeSegment): readonly string[] {
  if (segment.kind === "text") return segment.lines;
  const { choice, region, marker } = segment;
  switch (choice.kind) {
    case "open":
      return marker;
    case "picked":
      return choice.picks.map((pick) => pickedLine(region, pick));
    case "edited":
      return choice.lines;
  }
}

export function pickedLine(region: ConflictRegion, pick: LinePick) {
  return region[pick.side][pick.index] ?? "";
}

export function displayText(model: MergeModel) {
  return model.segments.flatMap(segmentLines).join("\n");
}

export function fileContent(model: MergeModel) {
  return model.segments.flatMap(segmentLines).join(model.eol);
}

export function regionSegments(model: MergeModel): readonly RegionSegment[] {
  return model.segments.filter(
    (segment): segment is RegionSegment => segment.kind === "region",
  );
}

export function openRegionCount(model: MergeModel) {
  return regionSegments(model).filter(({ choice }) => choice.kind === "open")
    .length;
}

const noPicks: readonly LinePick[] = [];

export function choicePicks(choice: RegionChoice): readonly LinePick[] {
  return choice.kind === "open" ? noPicks : choice.picks;
}

export function choosePicks(
  model: MergeModel,
  regionId: string,
  picks: readonly LinePick[],
): MergeModel {
  return withChoice(
    model,
    regionId,
    picks.length === 0 ? { kind: "open" } : { kind: "picked", picks },
  );
}

export function chooseSide(
  model: MergeModel,
  regionId: string,
  side: ConflictSide,
): MergeModel {
  const segment = regionSegments(model).find(
    ({ region }) => region.id === regionId,
  );
  if (segment === undefined) return model;
  const picks = segment.region[side].map((_, index) => ({ side, index }));
  return withChoice(model, regionId, { kind: "picked", picks });
}

export function restoreRegion(model: MergeModel, regionId: string) {
  return withChoice(model, regionId, { kind: "open" });
}

function withChoice(
  model: MergeModel,
  regionId: string,
  choice: RegionChoice,
): MergeModel {
  return {
    ...model,
    segments: model.segments.map((segment) =>
      segment.kind === "region" && segment.region.id === regionId
        ? { ...segment, choice }
        : segment,
    ),
  };
}

function openAnchors(
  document: ConflictDocument,
  lines: readonly string[],
): Anchor[] {
  const unmatched = document.regions.filter(({ open }) => open);
  return markerBlocks(lines).flatMap((block): Anchor[] => {
    const exact = unmatched.findIndex(
      (region) =>
        sameLines(region.current, block.current) &&
        sameLines(region.incoming, block.incoming),
    );
    const [region] = unmatched.splice(exact === -1 ? 0 : exact, 1);
    if (region === undefined) return [];
    const marker = lines.slice(block.start, block.end + 1);
    return [
      {
        start: block.start,
        length: marker.length,
        segment: { kind: "region", region, marker, choice: { kind: "open" } },
      },
    ];
  });
}

function decidedAnchors(
  document: ConflictDocument,
  lines: readonly string[],
): Anchor[] {
  return document.regions.flatMap((region): Anchor[] => {
    if (region.open || region.line === null) return [];
    const start = Math.min(Math.max(region.line - 1, 0), lines.length);
    const marker = gitMarker(document, region);
    const side = (["current", "incoming"] as const).find((candidate) =>
      sameLines(
        lines.slice(start, start + region[candidate].length),
        region[candidate],
      ),
    );
    const picks =
      side === undefined
        ? []
        : region[side].map((_, index) => ({ side, index }));
    return [
      {
        start,
        length: picks.length,
        segment: {
          kind: "region",
          region,
          marker,
          choice:
            side === undefined
              ? { kind: "edited", picks, lines: [] }
              : { kind: "picked", picks },
        },
      },
    ];
  });
}

function placeAnchors(
  lines: readonly string[],
  anchors: readonly Anchor[],
): MergeSegment[] {
  const segments: MergeSegment[] = [];
  let cursor = 0;
  for (const anchor of anchors) {
    if (anchor.start < cursor) continue;
    if (anchor.start > cursor)
      segments.push({ kind: "text", lines: lines.slice(cursor, anchor.start) });
    segments.push(anchor.segment);
    cursor = anchor.start + anchor.length;
  }
  if (cursor < lines.length)
    segments.push({ kind: "text", lines: lines.slice(cursor) });
  return segments;
}

function gitMarker(document: ConflictDocument, region: ConflictRegion) {
  return [
    `<<<<<<< ${sideName(document, "current")}`,
    ...region.current,
    "=======",
    ...region.incoming,
    `>>>>>>> ${sideName(document, "incoming")}`,
  ];
}

function sideName(document: ConflictDocument, side: ConflictSide) {
  const { ref, commit, subject } = document.sides[side];
  if (ref !== null) return ref;
  if (commit === null) return side;
  return subject === null
    ? commit.slice(0, 7)
    : `${commit.slice(0, 7)} (${subject})`;
}

export function sameLines(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((line, index) => line === right[index])
  );
}
