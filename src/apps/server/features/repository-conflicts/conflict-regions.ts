import { diffArrays } from "diff";
import type { TokenMark } from "#contracts/repository-conflicts/repository-conflicts.contract.ts";

interface MarkerBlock {
  readonly line: number;
  readonly current: readonly string[];
  readonly base: readonly string[];
  readonly incoming: readonly string[];
}

type Section = "current" | "base" | "incoming";

interface Token {
  readonly text: string;
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

const tokenPattern = /\w+|\s+|[^\w\s]/g;
const lineBreak = "\n";
const maximumEdits = 2_000;

export function markerBlocks(text: string, size: number) {
  const open = "<".repeat(size);
  const base = "|".repeat(size);
  const separator = "=".repeat(size);
  const close = ">".repeat(size);
  const blocks: MarkerBlock[] = [];
  let block: { line: number; section: Section } & Record<Section, string[]> =
    emptyBlock(0);
  let inside = false;
  splitLines(text).forEach((line, index) => {
    if (isMarker(line, open)) {
      block = emptyBlock(index + 1);
      inside = true;
    } else if (!inside) {
      return;
    } else if (block.section === "current" && isMarker(line, base)) {
      block.section = "base";
    } else if (block.section !== "incoming" && isMarker(line, separator)) {
      block.section = "incoming";
    } else if (block.section === "incoming" && isMarker(line, close)) {
      const { section: _, ...complete } = block;
      blocks.push(complete);
      inside = false;
    } else {
      block[block.section].push(line);
    }
  });
  return blocks;
}

export function openRegionLines(
  regions: readonly MarkerBlock[],
  blocks: readonly MarkerBlock[],
) {
  const remaining = [...blocks];
  return regions.map((region) => {
    const index = remaining.findIndex(
      (block) =>
        sameLines(block.current, region.current) &&
        sameLines(block.incoming, region.incoming),
    );
    return index < 0 ? null : (remaining.splice(index, 1)[0]?.line ?? null);
  });
}

export function tokenMarks(
  base: readonly string[],
  side: readonly string[],
): TokenMark[] {
  const changes = diffArrays(tokens(base), tokens(side), {
    comparator: (left, right) => left.text === right.text,
    maxEditLength: maximumEdits,
  });
  if (changes === undefined)
    return side.flatMap((line, index) =>
      line.length === 0 ? [] : [{ line: index, start: 0, end: line.length }],
    );
  const marks: TokenMark[] = [];
  for (const change of changes)
    if (change.added)
      for (const token of change.value)
        if (token.text !== lineBreak) appendMark(marks, token);
  return marks;
}

function splitLines(text: string) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

function emptyBlock(line: number) {
  return {
    line,
    section: "current" as Section,
    current: [],
    base: [],
    incoming: [],
  };
}

function isMarker(line: string, marker: string) {
  return line === marker || line.startsWith(`${marker} `);
}

function sameLines(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((line, index) => line === right[index])
  );
}

function tokens(lines: readonly string[]) {
  return lines.flatMap((line, index): Token[] => [
    ...Array.from(line.matchAll(tokenPattern), (match) => ({
      text: match[0],
      line: index,
      start: match.index,
      end: match.index + match[0].length,
    })),
    { text: lineBreak, line: index, start: line.length, end: line.length },
  ]);
}

function appendMark(marks: TokenMark[], token: Token) {
  const previous = marks.at(-1);
  if (previous?.line === token.line && previous.end === token.start)
    marks[marks.length - 1] = { ...previous, end: token.end };
  else marks.push({ line: token.line, start: token.start, end: token.end });
}
