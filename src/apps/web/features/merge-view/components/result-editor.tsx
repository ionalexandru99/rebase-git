import { type CSSProperties, type RefObject, useMemo } from "react";
import { Button } from "#web/components/ui/button";
import type { MergeModel } from "#web/features/merge-view/conflict-document";
import {
  displayText,
  type LineOrigin,
  type ResultBlock,
  regionAtLine,
  resultBlocks,
} from "#web/features/merge-view/result-text";
import { cn } from "#web/lib/utils";

const lineHeight = 20;

const originEdges: Record<LineOrigin | "open", string> = {
  base: "bg-muted-foreground",
  current: "bg-[#69b1ff]",
  incoming: "bg-[#5ecc71]",
  edited: "bg-[rgb(255_255_255/55%)]",
  open: "bg-[rgb(255_255_255/14%)]",
};

const openBlock: CSSProperties = {
  background:
    "repeating-linear-gradient(135deg, rgb(255 255 255 / 4%) 0 5px, transparent 5px 12px)",
  boxShadow: "inset 0 0 0 1px rgb(255 255 255 / 5%)",
};

export function ResultEditor({
  model,
  onEdit,
  onUndo,
  onRegionClick,
  scrollRef,
}: {
  readonly model: MergeModel;
  readonly onEdit: (text: string, caret: number) => void;
  readonly onUndo: (regionId: string) => void;
  readonly onRegionClick: (regionId: string) => void;
  readonly scrollRef: RefObject<HTMLDivElement | null>;
}) {
  const text = useMemo(() => displayText(model), [model]);
  const blocks = useMemo(() => resultBlocks(model), [model]);
  const lines = text.split("\n");
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
                  className="absolute inset-x-0"
                  style={{ ...openBlock, ...blockPosition(block) }}
                />
              ),
          )}
          <textarea
            aria-label="Result"
            value={text}
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
              const regionId = regionAtLine(
                model,
                value.slice(0, selectionStart).split("\n").length - 1,
              );
              if (regionId !== null) onRegionClick(regionId);
            }}
          />
        </div>
      </div>
    </div>
  );
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
        aria-hidden="true"
        className={cn("absolute left-0 w-[3px]", originEdges.open)}
        style={blockPosition(block)}
      />
    );
  return (
    <>
      {block.length === 0 ? (
        <div
          aria-hidden="true"
          className={cn("absolute left-0 h-0.5 w-full", originEdges.edited)}
          style={{ top: block.start * lineHeight - 1 }}
        />
      ) : (
        block.edges.map((edge) => (
          <div
            key={edge.line}
            aria-hidden="true"
            className={cn("absolute left-0 w-[3px]", originEdges[edge.origin])}
            style={{
              top: edge.line * lineHeight,
              height: edge.length * lineHeight,
            }}
          />
        ))
      )}
      <Button
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

function blockPosition(block: ResultBlock): CSSProperties {
  return {
    top: block.start * lineHeight,
    height: Math.max(block.length, 1) * lineHeight,
  };
}
