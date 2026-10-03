import { IconCheck, IconLock, IconSearch } from "@tabler/icons-react";
import { type KeyboardEvent, type MouseEvent, useId, useState } from "react";
import {
  ActionMenuItems,
  keyAction,
  runAction,
} from "#web/components/ui/action-menu.tsx";
import { Button } from "#web/components/ui/button.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import {
  type WorktreeRow,
  type Worktrees,
  worktreeActions,
} from "#web/features/worktrees/worktrees.ts";

const newWorktreeId = "new";

export function WorktreeList({
  worktrees,
  onClose,
  onCreate,
}: {
  readonly worktrees: Worktrees;
  readonly onClose: () => void;
  readonly onCreate: () => void;
}) {
  const id = useId();
  const errorToast = useErrorToast();
  const [query, setQuery] = useState("");
  const rows = worktrees.rows.filter((row) =>
    `${row.name} ${row.detail}`.toLowerCase().includes(query.toLowerCase()),
  );
  const ids = [...rows.map(({ worktree }) => worktree.path), newWorktreeId];
  const [highlightedId, setHighlightedId] = useState<string>();
  const highlighted =
    highlightedId !== undefined && ids.includes(highlightedId)
      ? highlightedId
      : (ids[0] ?? newWorktreeId);
  const highlightedRow = rows.find(
    ({ worktree }) => worktree.path === highlighted,
  );
  const elementId = (key: string) =>
    `${id}-${ids.indexOf(key) < 0 ? newWorktreeId : ids.indexOf(key)}`;
  const switchTo = (row: WorktreeRow) => {
    if (!row.active && row.worktree.missing !== true) worktrees.switchTo(row);
    onClose();
  };
  const actionsFor = (row: WorktreeRow) =>
    worktreeActions(row, worktrees.writable, {
      switchTo: () => switchTo(row),
      copyPath: () =>
        void writeClipboardText(row.worktree.path).catch(() =>
          errorToast.show("copyPath"),
        ),
      unlock: () => void worktrees.unlock(row),
      remove: () => {
        if (row.worktree.missing !== true) onClose();
        worktrees.remove(row);
      },
    });
  const activate = (key: string) => {
    if (key === newWorktreeId) {
      if (worktrees.writable) onCreate();
      return;
    }
    const row = rows.find(({ worktree }) => worktree.path === key);
    if (row !== undefined) switchTo(row);
  };
  const move = (offset: number) => {
    const index = Math.max(
      0,
      Math.min(ids.length - 1, ids.indexOf(highlighted) + offset),
    );
    const next = ids[index];
    if (next === undefined) return;
    setHighlightedId(next);
    document
      .getElementById(elementId(next))
      ?.scrollIntoView({ block: "nearest" });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Enter") activate(highlighted);
    else if (
      highlightedRow !== undefined &&
      (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey))
    )
      openMenu(elementId(highlighted));
    else if (
      highlightedRow === undefined ||
      query.length > 0 ||
      !runAction(keyAction(actionsFor(highlightedRow), event.key))
    )
      return;
    event.preventDefault();
  };
  const selectRow = (event: MouseEvent<HTMLElement>) => {
    const key = (event.target as Element)
      .closest("[data-worktree]")
      ?.getAttribute("data-worktree");
    if (key === null || key === undefined || key === newWorktreeId) {
      if (event.type === "contextmenu") event.preventDefault();
      return;
    }
    setHighlightedId(key);
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="relative p-1">
        <IconSearch
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-activedescendant={elementId(highlighted)}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          aria-expanded="true"
          aria-label="Find worktree"
          autoComplete="off"
          autoFocus
          className="h-7 pl-7 text-[.85rem] sm:h-7 sm:text-[.85rem]"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find worktree"
          role="combobox"
          spellCheck={false}
          value={query}
        />
      </div>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              aria-label="Worktrees"
              className="flex max-h-80 flex-col gap-0.5 overflow-y-auto"
              id={`${id}-list`}
              onContextMenu={selectRow}
              onPointerDown={selectRow}
              role="listbox"
            >
              {rows.map((row) => (
                <WorktreeOption
                  key={row.worktree.path}
                  row={row}
                  elementId={elementId(row.worktree.path)}
                  highlighted={row.worktree.path === highlighted}
                  canPrune={worktrees.writable}
                  onSelect={() => switchTo(row)}
                  onPrune={() => worktrees.remove(row)}
                />
              ))}
              <button
                aria-selected={highlighted === newWorktreeId}
                className={`mt-0.5 flex h-8 cursor-default items-center rounded-[.35rem] border-t border-border px-2 text-left text-[.85rem] text-foreground/80 outline-none disabled:opacity-45 ${highlighted === newWorktreeId ? "bg-accent text-foreground" : ""}`}
                data-worktree={newWorktreeId}
                disabled={!worktrees.writable}
                id={elementId(newWorktreeId)}
                onClick={onCreate}
                role="option"
                tabIndex={-1}
                type="button"
              >
                New worktree…
              </button>
            </div>
          }
        />
        {highlightedRow === undefined ? null : (
          <ContextMenuContent className="w-max min-w-56 max-w-md">
            <ActionMenuItems actions={actionsFor(highlightedRow)} />
          </ContextMenuContent>
        )}
      </ContextMenu>
    </div>
  );
}

function WorktreeOption({
  row,
  elementId,
  highlighted,
  canPrune,
  onSelect,
  onPrune,
}: {
  readonly row: WorktreeRow;
  readonly elementId: string;
  readonly highlighted: boolean;
  readonly canPrune: boolean;
  readonly onSelect: () => void;
  readonly onPrune: () => void;
}) {
  const { worktree } = row;
  const missing = worktree.missing === true;
  return (
    <div className="relative flex" role="none">
      <button
        aria-current={row.active || undefined}
        aria-label={[
          row.name,
          row.detail,
          ...(worktree.locked === undefined ? [] : ["locked"]),
          ...(row.changes ? [`${row.changes} uncommitted changes`] : []),
        ].join(", ")}
        aria-selected={highlighted}
        className={`flex h-10 min-w-0 flex-1 cursor-default items-center gap-2 rounded-[.35rem] px-2 text-left outline-none ${highlighted ? "bg-accent text-foreground" : "text-foreground/80"} ${missing ? "pr-16" : ""}`}
        data-worktree={worktree.path}
        id={elementId}
        onClick={onSelect}
        role="option"
        tabIndex={-1}
        type="button"
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          {row.active ? (
            <IconCheck aria-hidden="true" className="size-3.5" />
          ) : null}
        </span>
        <span
          className={`flex min-w-0 flex-1 flex-col ${missing ? "opacity-50" : ""}`}
        >
          <span className="truncate text-[.85rem]">{row.name}</span>
          <span className="truncate text-[.72rem] text-muted-foreground">
            {row.detail}
          </span>
        </span>
        {worktree.locked === undefined ? null : (
          <IconLock
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground"
          />
        )}
        {row.changes ? (
          <span className="shrink-0 text-[.7rem] text-muted-foreground tabular-nums">
            {row.changes}
          </span>
        ) : null}
      </button>
      {missing && worktree.locked === undefined ? (
        <Button
          aria-label={`Prune ${row.name}`}
          className="absolute top-1/2 right-2 -translate-y-1/2"
          disabled={!canPrune}
          onClick={onPrune}
          size="xs"
          tabIndex={-1}
          variant="ghost"
        >
          Prune
        </Button>
      ) : null}
    </div>
  );
}

function openMenu(elementId: string) {
  const element = document.getElementById(elementId);
  if (element === null) return;
  const bounds = element.getBoundingClientRect();
  element.dispatchEvent(
    new globalThis.MouseEvent("contextmenu", {
      bubbles: true,
      clientX: bounds.left + 48,
      clientY: bounds.bottom,
    }),
  );
}
