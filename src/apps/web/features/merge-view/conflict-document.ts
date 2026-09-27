import type {
  ConflictDocument,
  ConflictRegion,
  ConflictSide,
} from "@rebase/contracts";

export interface LinePick {
  readonly side: ConflictSide;
  readonly index: number;
}

export type Picks = ReadonlyMap<string, readonly LinePick[]>;

export interface RegionSegment {
  readonly kind: "region";
  readonly region: ConflictRegion;
  readonly marker: readonly string[];
  readonly typed: readonly string[] | null;
}

export interface TextSegment {
  readonly kind: "text";
  readonly lines: readonly string[];
}

export type MergeSegment = TextSegment | RegionSegment;

export interface MergeModel {
  readonly eol: "\n" | "\r\n";
  readonly segments: readonly MergeSegment[];
}

export type PickMode = "add" | "remove";

const closingMarker = /^>{7,}(?:\s|$)/;
const noPicks: readonly LinePick[] = [];

export function mergeModel(document: ConflictDocument): MergeModel {
  const eol = document.content.includes("\r\n") ? "\r\n" : "\n";
  const lines = document.content.split(eol);
  const segments: MergeSegment[] = [];
  let cursor = 0;
  for (const region of openRegions(document)) {
    const start = region.line - 1;
    const end = closingLine(lines, start);
    if (start < cursor || end === -1) continue;
    if (start > cursor)
      segments.push({ kind: "text", lines: lines.slice(cursor, start) });
    const marker = lines.slice(start, end + 1);
    segments.push({ kind: "region", region, marker, typed: null });
    cursor = end + 1;
  }
  if (cursor < lines.length)
    segments.push({ kind: "text", lines: lines.slice(cursor) });
  return { eol, segments };
}

export function regionSegments(model: MergeModel): readonly RegionSegment[] {
  return model.segments.filter(
    (segment): segment is RegionSegment => segment.kind === "region",
  );
}

export function picksOf(picks: Picks, regionId: string) {
  return picks.get(regionId) ?? noPicks;
}

export function isOpen(segment: RegionSegment, picks: Picks) {
  return (
    segment.typed === null && picksOf(picks, segment.region.id).length === 0
  );
}

export function openCount(model: MergeModel, picks: Picks) {
  return regionSegments(model).filter((segment) => isOpen(segment, picks))
    .length;
}

export function segmentLines(
  segment: MergeSegment,
  picks: Picks,
): readonly string[] {
  if (segment.kind === "text") return segment.lines;
  if (segment.typed !== null) return segment.typed;
  const { region } = segment;
  const picked = picksOf(picks, region.id);
  if (picked.length > 0)
    return picked.map(({ side, index }) => region[side][index] ?? "");
  const height = Math.max(region.current.length, region.incoming.length, 1);
  return Array.from({ length: height }, () => "");
}

export function fileContent(model: MergeModel, picks: Picks) {
  return model.segments
    .flatMap((segment) =>
      segment.kind === "region" && isOpen(segment, picks)
        ? segment.marker
        : segmentLines(segment, picks),
    )
    .join(model.eol);
}

export function withTyped(
  model: MergeModel,
  regionId: string,
  typed: readonly string[] | null,
): MergeModel {
  return {
    ...model,
    segments: model.segments.map((segment) =>
      segment.kind === "region" && segment.region.id === regionId
        ? { ...segment, typed }
        : segment,
    ),
  };
}

export function pickPosition(picks: readonly LinePick[], pick: LinePick) {
  return picks.findIndex(
    ({ side, index }) => side === pick.side && index === pick.index,
  );
}

export function pickMode(picks: readonly LinePick[], pick: LinePick): PickMode {
  return pickPosition(picks, pick) === -1 ? "add" : "remove";
}

export function applyPick(
  picks: readonly LinePick[],
  pick: LinePick,
  mode: PickMode,
): readonly LinePick[] {
  const position = pickPosition(picks, pick);
  if (mode === "add") return position === -1 ? [...picks, pick] : picks;
  return position === -1
    ? picks
    : picks.filter((_, candidate) => candidate !== position);
}

export function togglePick(picks: readonly LinePick[], pick: LinePick) {
  return applyPick(picks, pick, pickMode(picks, pick));
}

export function pickRange(
  picks: readonly LinePick[],
  side: ConflictSide,
  from: number,
  to: number,
  mode: PickMode,
): readonly LinePick[] {
  const step = to >= from ? 1 : -1;
  let next = picks;
  for (let index = from; index !== to + step; index += step)
    next = applyPick(next, { side, index }, mode);
  return next;
}

export function sideTaken(
  picks: readonly LinePick[],
  region: ConflictRegion,
  side: ConflictSide,
) {
  return (
    region[side].length > 0 &&
    region[side].every((_, index) => pickPosition(picks, { side, index }) >= 0)
  );
}

export function takeSide(
  picks: readonly LinePick[],
  region: ConflictRegion,
  side: ConflictSide,
): readonly LinePick[] {
  if (region[side].length === 0) return picks;
  if (sideTaken(picks, region, side))
    return picks.filter((pick) => pick.side !== side);
  return pickRange(picks, side, 0, region[side].length - 1, "add");
}

function openRegions(document: ConflictDocument) {
  return document.regions
    .flatMap((region) =>
      region.open && region.line !== null
        ? [{ ...region, line: region.line }]
        : [],
    )
    .sort((left, right) => left.line - right.line);
}

function closingLine(lines: readonly string[], start: number) {
  for (let index = start + 1; index < lines.length; index += 1)
    if (closingMarker.test(lines[index] ?? "")) return index;
  return -1;
}
