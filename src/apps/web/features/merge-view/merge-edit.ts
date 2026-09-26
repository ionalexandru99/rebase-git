import {
  choicePicks,
  displayText,
  type MergeModel,
  type MergeSegment,
  sameLines,
  segmentLines,
} from "#web/features/merge-view/merge-model";

interface SegmentRange {
  readonly segment: MergeSegment;
  readonly start: number;
  readonly end: number;
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
  if (sameLines(lines, segment.marker))
    return { ...segment, choice: { kind: "open" } };
  return {
    ...segment,
    choice: { kind: "edited", picks: choicePicks(segment.choice), lines },
  };
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
