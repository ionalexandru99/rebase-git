export interface MarkerBlock {
  readonly start: number;
  readonly end: number;
  readonly current: readonly string[];
  readonly incoming: readonly string[];
}

const opening = /^<{7,}(?:\s|$)/;
const base = /^\|{7,}(?:\s|$)/;
const separator = /^={7,}$/;
const closing = /^>{7,}(?:\s|$)/;

export function markerBlocks(lines: readonly string[]): MarkerBlock[] {
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
    if (separatorLine === -1 && baseLine === -1 && base.test(line))
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
