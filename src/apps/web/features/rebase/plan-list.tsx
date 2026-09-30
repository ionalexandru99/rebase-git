import { type KeyboardEvent, useRef, useState } from "react";
import type { PlanAction } from "#contracts/repository-operations/repository-operations.contract.ts";
import {
  type Action,
  ActionMenuItems,
  keyAction,
  runAction,
} from "#web/components/ui/action-menu.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import { folds, type PlanRow } from "#web/features/rebase/rebase-plan.ts";
import { cn } from "#web/lib/utils.ts";

const planActions: readonly (readonly [PlanAction, string, string])[] = [
  ["pick", "Pick", "P"],
  ["reword", "Reword", "R"],
  ["edit", "Edit", "E"],
  ["squash", "Squash", "S"],
  ["fixup", "Fixup", "F"],
  ["drop", "Drop", "D"],
];

export const actionColors: Readonly<Record<PlanAction, string>> = {
  pick: "text-muted-foreground",
  reword: "text-sky-400",
  edit: "text-status-connecting",
  squash: "text-violet-400",
  fixup: "text-violet-400",
  drop: "text-destructive",
};

export function PlanList({
  rows,
  selected,
  invalid,
  subjects,
  disabled,
  select,
  move,
  apply,
  openMessage,
}: {
  readonly rows: readonly PlanRow[];
  readonly selected: number;
  readonly invalid: number | undefined;
  readonly subjects: Readonly<Record<string, string | undefined>>;
  readonly disabled: boolean;
  readonly select: (index: number) => void;
  readonly move: (from: number, to: number) => void;
  readonly apply: (index: number, action: PlanAction) => void;
  readonly openMessage: () => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number>();
  const rowActions = (index: number): readonly Action[] => {
    const editable = rows[index]?.merge === false && !disabled;
    return [
      ...planActions.map(([id, label, key]) => ({
        id,
        label,
        keys: [key],
        enabled: editable,
        run: () => apply(index, id),
      })),
      {
        id: "up",
        label: "Move up",
        keys: ["Alt+ArrowUp"],
        detail: "Alt+↑",
        group: "edit" as const,
        enabled: editable && index > 0,
        run: () => move(index, index - 1),
      },
      {
        id: "down",
        label: "Move down",
        keys: ["Alt+ArrowDown"],
        detail: "Alt+↓",
        group: "edit" as const,
        enabled: editable && index < rows.length - 1,
        run: () => move(index, index + 1),
      },
    ];
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey) return;
    const key = event.altKey
      ? `Alt+${event.key}`
      : event.key.length === 1
        ? event.key.toUpperCase()
        : event.key;
    const target = {
      ArrowUp: selected - 1,
      ArrowDown: selected + 1,
      Home: 0,
      End: rows.length - 1,
    }[key];
    if (target !== undefined) select(target);
    else if (key === "Enter") openMessage();
    else if (!runAction(keyAction(rowActions(selected), key))) return;
    event.preventDefault();
  };
  return (
    <div
      ref={list}
      role="listbox"
      aria-label="Plan"
      tabIndex={0}
      aria-activedescendant={`rebase-plan-${rows[selected]?.commit ?? ""}`}
      className="min-h-0 flex-1 overflow-auto py-1 outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset"
      onKeyDown={onKeyDown}
    >
      {rows.map((row, index) => (
        <ContextMenu
          key={row.commit}
          onOpenChange={(open) => {
            if (!open) list.current?.focus();
          }}
        >
          <ContextMenuTrigger
            render={
              <div
                id={`rebase-plan-${row.commit}`}
                role="option"
                tabIndex={-1}
                aria-selected={index === selected}
                aria-invalid={index === invalid}
                draggable={!row.merge && !disabled}
                onPointerDown={() => select(index)}
                onContextMenu={() => select(index)}
                onDragStart={() => setDragging(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragging !== undefined) move(dragging, index);
                  setDragging(undefined);
                }}
                className={cn(
                  "relative flex h-7 cursor-default items-center gap-2 px-3 whitespace-nowrap",
                  folds(row.action) &&
                    "pl-8 before:absolute before:top-1/2 before:bottom-0 before:left-4 before:w-2.5 before:rounded-tl before:border-border before:border-t before:border-l",
                  index === selected && "bg-accent/60",
                  index === invalid && "text-destructive",
                )}
              />
            }
          >
            <span
              className={cn(
                "w-12 shrink-0 font-mono text-[11px]",
                actionColors[row.action],
              )}
            >
              {row.action}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                row.action === "drop" && "text-muted-foreground line-through",
                subjects[row.commit] !== undefined && "text-sky-300",
              )}
            >
              {subjects[row.commit] ?? row.subject}
            </span>
            {row.merge ? (
              <span className="font-mono text-[10px] text-muted-foreground">
                merge
              </span>
            ) : null}
            <span className="font-mono text-[11px] text-muted-foreground">
              {row.commit.slice(0, 8)}
            </span>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-52">
            <ActionMenuItems
              actions={rowActions(index)}
              className="text-[.85rem] sm:text-[.85rem]"
            />
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  );
}
