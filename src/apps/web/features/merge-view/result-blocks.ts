import {
  type MergeModel,
  type RegionChoice,
  segmentLines,
} from "#web/features/merge-view/merge-model";
import type { LineOrigin } from "#web/features/merge-view/side-styles";

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

export function resultBlocks(model: MergeModel): readonly ResultBlock[] {
  const blocks: ResultBlock[] = [];
  let start = 0;
  let ordinal = 0;
  for (const segment of model.segments) {
    const length = segmentLines(segment).length;
    if (segment.kind === "region") {
      ordinal += 1;
      blocks.push({
        regionId: segment.region.id,
        ordinal,
        start,
        length,
        edges: originEdges(segment.choice, start),
      });
    }
    start += length;
  }
  return blocks;
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
