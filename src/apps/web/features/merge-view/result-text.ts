import {
  type MergeModel,
  type MergeSegment,
  type Picks,
  segmentLines,
} from "#web/features/merge-view/conflict-document.ts";

interface SegmentRange {
  readonly segment: MergeSegment;
  readonly start: number;
  readonly end: number;
}

function displayLines(model: MergeModel, picks: Picks) {
  return model.segments.flatMap((segment) => segmentLines(segment, picks));
}

export function editText(
  model: MergeModel,
  picks: Picks,
  text: string,
  caret: number,
): MergeModel {
  const before = displayLines(model, picks);
  const after = text.split("\n");
  const caretLine = text.slice(0, caret).split("\n").length - 1;
  let prefix = 0;
  const prefixLimit = Math.min(before.length, after.length, caretLine);
  while (prefix < prefixLimit && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  const suffixLimit = Math.min(
    before.length - prefix,
    after.length - caretLine - 1,
  );
  while (
    suffix < suffixLimit &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix += 1;
  let from = prefix;
  let to = before.length - suffix;
  let end = after.length - suffix;
  if (from === to && from > 0) from -= 1;
  else if (from === to && to < before.length) {
    to += 1;
    end += 1;
  }
  return replaceLines(model, picks, from, to, after.slice(from, end));
}

function replaceLines(
  model: MergeModel,
  picks: Picks,
  from: number,
  to: number,
  replacement: readonly string[],
): MergeModel {
  const ranges = segmentRanges(model, picks);
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
    ...segmentLines(first.segment, picks).slice(0, from - first.start),
    ...replacement,
    ...segmentLines(last.segment, picks).slice(to - last.start),
  ];
  return {
    ...model,
    segments: ranges.flatMap(({ segment }): MergeSegment[] => {
      if (segment === first.segment) return [withLines(segment, merged, picks)];
      if (!affected.some((range) => range.segment === segment))
        return [segment];
      return segment.kind === "text" ? [] : [withLines(segment, [], picks)];
    }),
  };
}

function segmentRanges(model: MergeModel, picks: Picks): SegmentRange[] {
  let start = 0;
  return model.segments.map((segment) => {
    const end = start + segmentLines(segment, picks).length;
    const range = { segment, start, end };
    start = end;
    return range;
  });
}

function withLines(
  segment: MergeSegment,
  lines: readonly string[],
  picks: Picks,
): MergeSegment {
  if (segment.kind === "text") return { kind: "text", lines };
  const shown = segmentLines(segment, picks);
  return shown.length === lines.length &&
    shown.every((line, index) => line === lines[index])
    ? segment
    : { ...segment, typed: lines };
}
