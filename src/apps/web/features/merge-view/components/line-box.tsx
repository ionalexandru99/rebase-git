import type { KeyboardEvent } from "react";
import type {
  LineSelection,
  LineTarget,
} from "#web/features/merge-view/hooks/use-line-selection";
import { pickPosition } from "#web/features/merge-view/line-picks";
import type { LinePick } from "#web/features/merge-view/merge-model";
import { checkedBoxes, sideNames } from "#web/features/merge-view/side-styles";
import { cn } from "#web/lib/utils";

export function LineBox({
  target,
  picks,
  lineCount,
  ordinal,
  focusable,
  selection,
  onFocus,
}: {
  readonly target: LineTarget;
  readonly picks: readonly LinePick[];
  readonly lineCount: number;
  readonly ordinal: number;
  readonly focusable: boolean;
  readonly selection: LineSelection;
  readonly onFocus: (regionId: string) => void;
}) {
  const position = pickPosition(picks, target);
  const checked = position !== -1;
  return (
    <button
      type="button"
      aria-pressed={checked}
      aria-label={`${sideNames[target.side]} line ${target.index + 1}, region ${ordinal}`}
      data-line-box=""
      data-region={target.regionId}
      data-side={target.side}
      data-index={target.index}
      tabIndex={focusable ? 0 : -1}
      className={cn(
        "flex size-4 items-center justify-center rounded-[3px] border font-sans text-[10px] font-semibold leading-none outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        checked ? checkedBoxes[target.side] : "border-border bg-background",
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.focus();
        selection.press(target, picks);
      }}
      onPointerEnter={() => selection.enter(target)}
      onFocus={() => onFocus(target.regionId)}
      onClick={(event) => {
        if (event.detail === 0) selection.toggle(target);
      }}
      onKeyDown={(event) => moveWithKeys(event, target, lineCount, selection)}
    >
      {checked ? position + 1 : null}
    </button>
  );
}

function moveWithKeys(
  event: KeyboardEvent<HTMLButtonElement>,
  target: LineTarget,
  lineCount: number,
  selection: LineSelection,
) {
  if (event.altKey || (event.key !== "ArrowDown" && event.key !== "ArrowUp"))
    return;
  event.preventDefault();
  const direction = event.key === "ArrowDown" ? 1 : -1;
  const boxes = [
    ...(event.currentTarget
      .closest("[data-gutter]")
      ?.querySelectorAll<HTMLElement>("[data-line-box]") ?? []),
  ];
  const next = boxes[boxes.indexOf(event.currentTarget) + direction];
  if (!event.shiftKey) return next?.focus();
  const index = target.index + direction;
  if (index < 0 || index >= lineCount) return;
  selection.extend(target, index);
  next?.focus();
}
