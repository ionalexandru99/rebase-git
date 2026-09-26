import type { ConflictSide } from "@rebase/contracts";
import {
  choicePicks,
  type MergeModel,
  type MergeSegment,
  openLines,
  type RegionChoice,
  sameLines,
  segmentLines,
} from "#web/features/merge-view/conflict-document";

export type LineOrigin = ConflictSide | "edited";

export interface OriginEdge {
  readonly origin: LineOrigin;
  readonly line: number;
  readonly length: number;
}

export interface ResultBlock {
  readonly regionId: string;
  readonly ordinal: number;
  readonly start: number;
  readonly length: number;
  readonly edges: readonly OriginEdge[] | null;
}

interface SegmentRange {
  readonly segment: MergeSegment;
  readonly start: number;
  readonly end: number;
}

export function displayText(model: MergeModel) {
  return model.segments.flatMap(segmentLines).join("\n");
}

export function editText(
  model: MergeModel,
  text: string,
  caret: number,
): MergeModel {
  const before = displayText(model);
  const suffix = commonSuffix(before, text, text.length - caret);
  const prefix = commonPrefix(
    before,
    text,
    Math.min(before.length, text.length) - suffix,
  );
  const from = lineAt(before, prefix);
  const to = lineAt(before, before.length - suffix) + 1;
  const replacement = text
    .split("\n")
    .slice(from, lineAt(text, text.length - suffix) + 1);
  return replaceLines(model, from, to, replacement);
}

export function resultBlocks(model: MergeModel): readonly ResultBlock[] {
  let ordinal = 0;
  return segmentRanges(model).flatMap(({ segment, start, end }) => {
    if (segment.kind === "text") return [];
    ordinal += 1;
    return [
      {
        regionId: segment.region.id,
        ordinal,
        start,
        length: end - start,
        edges: originEdges(segment.choice, start),
      },
    ];
  });
}

export function regionLineOffset(model: MergeModel, regionId: string) {
  return (
    segmentRanges(model).find(
      ({ segment }) =>
        segment.kind === "region" && segment.region.id === regionId,
    )?.start ?? null
  );
}

export function regionAtLine(model: MergeModel, line: number) {
  const range = segmentRanges(model).find(
    ({ start, end }) => line >= start && line < end,
  );
  return range?.segment.kind === "region" ? range.segment.region.id : null;
}

function segmentRanges(model: MergeModel): SegmentRange[] {
  let start = 0;
  return model.segments.map((segment) => {
    const end = start + segmentLines(segment).length;
    const range = { segment, start, end };
    start = end;
    return range;
  });
}

function originEdges(
  choice: RegionChoice,
  start: number,
): readonly OriginEdge[] | null {
  if (choice.kind === "open") return null;
  if (choice.kind === "edited")
    return [{ origin: "edited", line: start, length: choice.lines.length }];
  const edges: OriginEdge[] = [];
  choice.picks.forEach(({ side }, index) => {
    const last = edges.at(-1);
    if (last?.origin === side)
      edges[edges.length - 1] = { ...last, length: last.length + 1 };
    else edges.push({ origin: side, line: start + index, length: 1 });
  });
  return edges;
}

function replaceLines(
  model: MergeModel,
  from: number,
  to: number,
  replacement: readonly string[],
): MergeModel {
  const ranges = segmentRanges(model);
  const affected = ranges.filter(({ start, end }) =>
    end > start ? start < to && end > from : start > from && start < to,
  );
  const first = affected[0];
  const last = affected.at(-1);
  if (first === undefined || last === undefined)
    return {
      ...model,
      segments: [...model.segments, { kind: "text", lines: replacement }],
    };
  const merged = [
    ...segmentLines(first.segment).slice(0, from - first.start),
    ...replacement,
    ...segmentLines(last.segment).slice(to - last.start),
  ];
  return {
    ...model,
    segments: ranges.flatMap(({ segment }): MergeSegment[] => {
      if (segment === first.segment) return [withLines(segment, merged)];
      if (!affected.some((range) => range.segment === segment))
        return [segment];
      return segment.kind === "text" ? [] : [withLines(segment, [])];
    }),
  };
}

function withLines(
  segment: MergeSegment,
  lines: readonly string[],
): MergeSegment {
  if (segment.kind === "text") return { kind: "text", lines };
  if (
    segment.choice.kind === "open" &&
    sameLines(lines, openLines(segment.region))
  )
    return segment;
  return {
    ...segment,
    choice: { kind: "edited", picks: choicePicks(segment.choice), lines },
  };
}

function commonSuffix(left: string, right: string, limit: number) {
  const bound = Math.min(left.length, right.length, Math.max(limit, 0));
  let length = 0;
  while (
    length < bound &&
    left[left.length - 1 - length] === right[right.length - 1 - length]
  )
    length += 1;
  return length;
}

function commonPrefix(left: string, right: string, limit: number) {
  let length = 0;
  while (length < limit && left[length] === right[length]) length += 1;
  return length;
}

function lineAt(text: string, offset: number) {
  let line = 0;
  let index = text.indexOf("\n");
  while (index !== -1 && index < offset) {
    line += 1;
    index = text.indexOf("\n", index + 1);
  }
  return line;
}
