export interface MarkerBlock {
  readonly line: number;
  readonly current: readonly string[];
  readonly base: readonly string[];
  readonly incoming: readonly string[];
}

type Section = "current" | "base" | "incoming";

export function splitLines(text: string) {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

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

export function sideLineNumbers(
  sideLines: readonly string[],
  regions: readonly (readonly string[])[],
) {
  let cursor = 0;
  return regions.map((lines) => {
    if (lines.length === 0) return null;
    for (let start = cursor; start + lines.length <= sideLines.length; start++)
      if (lines.every((line, offset) => sideLines[start + offset] === line)) {
        cursor = start + lines.length;
        return start + 1;
      }
    return null;
  });
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
