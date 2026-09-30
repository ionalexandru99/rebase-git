import type { ConflictExcerpt } from "#contracts/repository-conflicts/repository-conflicts.contract.ts";

export interface ConflictBlock {
  readonly start: number;
  readonly end: number;
}

export interface ConflictText {
  readonly content: Buffer;
  readonly starts: readonly number[];
  readonly blocks: readonly ConflictBlock[];
}

const newline = 10;
const carriageReturn = 13;
const space = 32;
const open = 60;
const separator = 61;
const close = 62;
const base = 124;
const markerBytes = new Set([open, separator, close, base]);
const excerptContext = 3;

export function conflictText(
  content: Buffer,
  markerSize: number,
): ConflictText {
  const starts = lineStarts(content);
  return {
    content,
    starts,
    blocks: conflictBlocks(content, starts, markerSize),
  };
}

export function conflictExcerpts({
  content,
  starts,
  blocks,
}: ConflictText): ConflictExcerpt[] {
  const lines = starts.length - 1;
  const ranges: { from: number; to: number }[] = [];
  for (const block of blocks) {
    const from = Math.max(0, block.start - excerptContext);
    const to = Math.min(lines, block.end + 1 + excerptContext);
    const previous = ranges.at(-1);
    if (previous !== undefined && from <= previous.to) previous.to = to;
    else ranges.push({ from, to });
  }
  return ranges.map(({ from, to }) => ({
    line: from + 1,
    text: content.toString("utf8", starts[from], starts[to]),
  }));
}

export function replaceLines(
  content: Buffer,
  line: number,
  count: number,
  text: string,
) {
  const starts = lineStarts(content);
  const from = line - 1;
  const to = from + count;
  if (to > starts.length - 1) return null;
  return Buffer.concat([
    content.subarray(0, starts[from]),
    Buffer.from(text),
    content.subarray(starts[to]),
  ]);
}

function lineStarts(content: Buffer) {
  const starts = [0];
  let at = content.indexOf(newline);
  while (at !== -1 && at + 1 < content.length) {
    starts.push(at + 1);
    at = content.indexOf(newline, at + 1);
  }
  starts.push(content.length);
  return starts;
}

function conflictBlocks(
  content: Buffer,
  starts: readonly number[],
  size: number,
) {
  const blocks: ConflictBlock[] = [];
  let section: "outside" | "current" | "base" | "incoming" = "outside";
  let start = 0;
  for (let line = 0; line + 1 < starts.length; line++) {
    const from = starts[line] ?? 0;
    const to = starts[line + 1] ?? from;
    if (!markerBytes.has(content[from] ?? 0)) continue;
    const is = (marker: number) => isMarker(content, from, to, marker, size);
    if (is(open)) {
      section = "current";
      start = line;
    } else if (section === "current" && is(base)) section = "base";
    else if ((section === "current" || section === "base") && is(separator))
      section = "incoming";
    else if (section === "incoming" && is(close)) {
      blocks.push({ start, end: line });
      section = "outside";
    }
  }
  return blocks;
}

function isMarker(
  content: Buffer,
  from: number,
  to: number,
  marker: number,
  size: number,
) {
  let end = to;
  if (end > from && content[end - 1] === newline) end--;
  if (end > from && content[end - 1] === carriageReturn) end--;
  if (end - from < size) return false;
  for (let index = from; index < from + size; index++)
    if (content[index] !== marker) return false;
  return end - from === size || content[from + size] === space;
}
