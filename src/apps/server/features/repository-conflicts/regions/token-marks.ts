import type { TokenMark } from "@rebase/contracts";
import { diffArrays } from "diff";

interface Token {
  readonly text: string;
  readonly line: number;
  readonly start: number;
  readonly end: number;
}

const tokenPattern = /\w+|\s+|[^\w\s]/g;
const lineBreak = "\n";
const maximumEdits = 2_000;

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
