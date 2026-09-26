export type MarkerSegmentKind =
  | "text"
  | "marker"
  | "current"
  | "base"
  | "incoming";

export interface MarkerSegment {
  readonly kind: MarkerSegmentKind;
  readonly line: number;
  readonly text: string;
}

type Block = "outside" | "current" | "base" | "incoming";

export function markerSegments(content: string): readonly MarkerSegment[] {
  const lines = content.split("\n");
  if (lines.at(-1) === "") lines.pop();
  const segments: {
    kind: MarkerSegmentKind;
    line: number;
    lines: string[];
  }[] = [];
  let block: Block = "outside";
  for (const [index, line] of lines.entries()) {
    const next = transition(block, line);
    const kind = next !== undefined ? "marker" : blockKind(block);
    const last = segments.at(-1);
    if (last?.kind === kind) last.lines.push(line);
    else segments.push({ kind, line: index + 1, lines: [line] });
    if (next !== undefined) block = next;
  }
  return segments.map(({ kind, line, lines }) => ({
    kind,
    line,
    text: `${lines.join("\n")}\n`,
  }));
}

function blockKind(block: Block): MarkerSegmentKind {
  return block === "outside" ? "text" : block;
}

function transition(block: Block, line: string): Block | undefined {
  if (block === "outside")
    return /^<{7}(\s|$)/.test(line) ? "current" : undefined;
  if (block === "current" && /^\|{7}(\s|$)/.test(line)) return "base";
  if (block !== "incoming" && /^={7}\r?$/.test(line)) return "incoming";
  if (block === "incoming" && /^>{7}(\s|$)/.test(line)) return "outside";
  return undefined;
}
