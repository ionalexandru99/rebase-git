import { type RefObject, useMemo } from "react";
import type { ConflictSide } from "#contracts/repository-conflicts/repository-conflicts.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import { sideColours } from "#web/features/merge-view/components/pane-lines.tsx";
import {
  isOpen,
  type MergeModel,
  type Picks,
  picksOf,
  segmentLines,
} from "#web/features/merge-view/conflict-document.ts";
import { cn } from "#web/lib/utils.ts";

const lineHeight = 20;
const typedEdge = "bg-foreground/55";

interface Edge {
  readonly colour: string;
  readonly line: number;
  readonly length: number;
}

interface ResultBlock {
  readonly regionId: string;
  readonly ordinal: number;
  readonly start: number;
  readonly length: number;
  readonly edges: readonly Edge[] | null;
}

export function ResultEditor({
  model,
  picks,
  onEdit,
  onUndo,
  onRegionClick,
  scrollRef,
}: {
  readonly model: MergeModel;
  readonly picks: Picks;
  readonly onEdit: (text: string, caret: number) => void;
  readonly onUndo: (regionId: string) => void;
  readonly onRegionClick: (regionId: string) => void;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const { lines, blocks } = useMemo(
    () => resultLayout(model, picks),
    [model, picks],
  );
  const width = lines.reduce(
    (widest, line) => Math.max(widest, line.length),
    0,
  );
  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-auto border-border border-t"
    >
      <div
        className="relative flex min-w-full font-mono text-xs leading-5"
        style={{
          height: (lines.length + 1) * lineHeight,
          width: `max(100%, calc(${width}ch + 6rem))`,
        }}
      >
        <div className="sticky left-0 z-10 w-14 shrink-0 bg-repository select-none">
          {blocks.map((block) => (
            <BlockGutter key={block.regionId} block={block} onUndo={onUndo} />
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          {blocks.map(
            (block) =>
              block.edges === null && (
                <div
                  key={block.regionId}
                  aria-hidden="true"
                  className="absolute inset-x-0 bg-[repeating-linear-gradient(135deg,rgb(255_255_255/4%)_0_5px,transparent_5px_12px)] shadow-[inset_0_0_0_1px_rgb(255_255_255/5%)]"
                  style={blockPosition(block)}
                />
              ),
          )}
          <textarea
            aria-label="Result"
            value={lines.join("\n")}
            wrap="off"
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="absolute inset-0 resize-none overflow-hidden bg-transparent px-2 font-mono text-xs leading-5 whitespace-pre text-foreground outline-none"
            onChange={(event) =>
              onEdit(
                event.currentTarget.value,
                event.currentTarget.selectionEnd,
              )
            }
            onClick={(event) => {
              const { value, selectionStart } = event.currentTarget;
              const line =
                value.slice(0, selectionStart).split("\n").length - 1;
              const block = blocks.find(
                ({ start, length }) => line >= start && line < start + length,
              );
              if (block !== undefined) onRegionClick(block.regionId);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function resultLayout(model: MergeModel, picks: Picks) {
  const lines: string[] = [];
  const blocks: ResultBlock[] = [];
  for (const segment of model.segments) {
    const start = lines.length;
    const shown = segmentLines(segment, picks);
    lines.push(...shown);
    if (segment.kind === "text") continue;
    const { region } = segment;
    blocks.push({
      regionId: region.id,
      ordinal: blocks.length + 1,
      start,
      length: shown.length,
      edges: isOpen(segment, picks)
        ? null
        : segment.typed !== null
          ? [{ colour: typedEdge, line: start, length: shown.length }]
          : pickEdges(picksOf(picks, region.id), start),
    });
  }
  return { lines, blocks };
}

function pickEdges(
  picks: readonly { readonly side: ConflictSide }[],
  start: number,
): Edge[] {
  const edges: Edge[] = [];
  picks.forEach(({ side }, index) => {
    const colour = sideColours[side].edge;
    const last = edges.at(-1);
    if (last?.colour === colour)
      edges[edges.length - 1] = { ...last, length: last.length + 1 };
    else edges.push({ colour, line: start + index, length: 1 });
  });
  return edges;
}

function BlockGutter({
  block,
  onUndo,
}: {
  readonly block: ResultBlock;
  readonly onUndo: (regionId: string) => void;
}) {
  if (block.edges === null)
    return (
      <div
        data-region={block.regionId}
        aria-hidden="true"
        className="absolute left-0 w-[3px] bg-foreground/15"
        style={blockPosition(block)}
      />
    );
  return (
    <>
      {block.length === 0 ? (
        <div
          aria-hidden="true"
          className={cn("absolute left-0 h-0.5 w-full", typedEdge)}
          style={{ top: block.start * lineHeight - 1 }}
        />
      ) : (
        block.edges.map((edge) => (
          <div
            key={edge.line}
            aria-hidden="true"
            className={cn("absolute left-0 w-[3px]", edge.colour)}
            style={{
              top: edge.line * lineHeight,
              height: edge.length * lineHeight,
            }}
          />
        ))
      )}
      <Button
        data-region={block.regionId}
        variant="ghost"
        size="xs"
        aria-label={`Undo region ${block.ordinal}`}
        className="absolute right-1 h-5 px-1 text-[11px] text-muted-foreground sm:h-5"
        style={{
          top: Math.max(
            block.start * lineHeight - (block.length === 0 ? 10 : 0),
            0,
          ),
        }}
        onClick={() => onUndo(block.regionId)}
      >
        Undo
      </Button>
    </>
  );
}

function blockPosition(block: ResultBlock) {
  return {
    top: block.start * lineHeight,
    height: Math.max(block.length, 1) * lineHeight,
  };
}
