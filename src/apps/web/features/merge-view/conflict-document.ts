import type {
  ConflictDocument,
  ConflictRegion,
  ConflictSide,
} from "@rebase/contracts";

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

interface MarkerBlock {
  readonly start: number;
  readonly end: number;
  readonly current: readonly string[];
  readonly incoming: readonly string[];
}

const opening = /^<{7,}(?:\s|$)/;
const baseMarker = /^\|{7,}(?:\s|$)/;
const separator = /^={7,}$/;
const closing = /^>{7,}(?:\s|$)/;
const noPicks: readonly LinePick[] = [];

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

function regionHeight(region: ConflictRegion) {
  return Math.max(region.current.length, region.incoming.length, 1);
}

export function openLines(region: ConflictRegion): readonly string[] {
  return Array.from({ length: regionHeight(region) }, () => "");
}

export function segmentLines(segment: MergeSegment): readonly string[] {
  if (segment.kind === "text") return segment.lines;
  const { choice, region } = segment;
  switch (choice.kind) {
    case "open":
      return openLines(region);
    case "picked":
      return choice.picks.map((pick) => region[pick.side][pick.index] ?? "");
    case "edited":
      return choice.lines;
  }
}

export function fileContent(model: MergeModel) {
  return model.segments
    .flatMap((segment) =>
      segment.kind === "region" && segment.choice.kind === "open"
        ? segment.marker
        : segmentLines(segment),
    )
    .join(model.eol);
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

export function choicePicks(choice: RegionChoice): readonly LinePick[] {
  return choice.kind === "open" ? noPicks : choice.picks;
}

export function regionPicks(model: MergeModel, regionId: string) {
  const segment = regionSegments(model).find(
    ({ region }) => region.id === regionId,
  );
  return segment === undefined ? noPicks : choicePicks(segment.choice);
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

export function restoreRegion(model: MergeModel, regionId: string) {
  return withChoice(model, regionId, { kind: "open" });
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
          marker: gitMarker(document, region),
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

function markerBlocks(lines: readonly string[]): MarkerBlock[] {
  const blocks: MarkerBlock[] = [];
  for (let start = 0; start < lines.length; start += 1) {
    if (!opening.test(lines[start] ?? "")) continue;
    const block = readBlock(lines, start);
    if (block === null) continue;
    blocks.push(block);
    start = block.end;
  }
  return blocks;
}

function readBlock(
  lines: readonly string[],
  start: number,
): MarkerBlock | null {
  let baseLine = -1;
  let separatorLine = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (opening.test(line)) return null;
    if (separatorLine === -1 && baseLine === -1 && baseMarker.test(line))
      baseLine = index;
    else if (separatorLine === -1 && separator.test(line))
      separatorLine = index;
    else if (separatorLine !== -1 && closing.test(line))
      return {
        start,
        end: index,
        current: lines.slice(
          start + 1,
          baseLine === -1 ? separatorLine : baseLine,
        ),
        incoming: lines.slice(separatorLine + 1, index),
      };
  }
  return null;
}
