import { useLayoutEffect, useRef, useState } from "react";
import type { RepositoryStash } from "#contracts/repository-stashes/repository-stashes.contract.ts";
import {
  type Action,
  ActionMenuItems,
} from "#web/components/ui/action-menu.tsx";
import { Confirmation } from "#web/components/ui/confirmation.tsx";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "#web/components/ui/context-menu.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { PersistentNotification } from "#web/features/notifications/components/persistent-notification.tsx";
import type {
  StashCommands,
  StashSelection,
} from "#web/features/stashes/stashes.ts";
import { ageLabel, useNow } from "#web/lib/age-label.ts";

export function StashRow({
  stash,
  actions,
  active,
  elementId,
  position,
  setSize,
  onActivate,
  onOpen,
}: {
  readonly stash: RepositoryStash;
  readonly actions: readonly Action[];
  readonly active: boolean;
  readonly elementId: string;
  readonly position: number;
  readonly setSize: number;
  readonly onActivate: () => void;
  readonly onOpen: () => void;
}) {
  const now = useNow();
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <div
            className={`flex h-8 w-full cursor-default items-center rounded-control text-[.85rem] text-sidebar-foreground outline-none select-none hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground ${active ? "bg-sidebar-accent" : ""}`}
          >
            <button
              aria-label={stashLabel(stash)}
              aria-level={2}
              aria-posinset={position}
              aria-selected={active}
              aria-setsize={setSize}
              className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-control pr-2 pl-[1.6rem] text-left outline-none"
              id={elementId}
              onClick={() => {
                onActivate();
                onOpen();
              }}
              onContextMenu={onActivate}
              role="treeitem"
              tabIndex={-1}
              type="button"
            >
              <span
                className={`min-w-0 truncate ${stash.named ? "" : "text-muted-foreground"}`}
              >
                {stash.name}
              </span>
              {stash.auto ? (
                <span className="shrink-0 rounded-control bg-muted px-1 text-[.65rem] text-muted-foreground">
                  auto
                </span>
              ) : null}
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {ageLabel(stash.recordedAt, now)}
              </span>
            </button>
          </div>
        }
      />
      <ContextMenuContent className="w-max min-w-56 max-w-md">
        <ActionMenuItems actions={actions} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function StashNameField({
  selection,
  initialName,
  commands,
  onDone,
}: {
  readonly selection: StashSelection;
  readonly initialName: string;
  readonly commands: StashCommands;
  readonly onDone: () => void;
}) {
  const [name, setName] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const submit = async () => {
    const chosen = name.trim();
    const stored = await commands.store(
      selection,
      undefined,
      chosen === "" || chosen === initialName ? undefined : chosen,
    );
    if (stored) onDone();
  };
  const count = selection.paths.length;
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1 py-0.5"
      onBlur={(event) => {
        if (
          !commands.saving &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          onDone();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Escape") return;
        event.preventDefault();
        onDone();
      }}
    >
      <Input
        aria-label="Stash name"
        autoComplete="off"
        className="h-7 text-[.85rem] sm:h-7 sm:text-[.85rem]"
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (!commands.saving) void submit();
        }}
        readOnly={commands.saving}
        ref={inputRef}
        spellCheck={false}
        value={name}
      />
      <p className="px-1 text-[.72rem] text-muted-foreground">
        {count} {selection.section} {count === 1 ? "file" : "files"}
      </p>
    </fieldset>
  );
}

export function StashDropConfirmation({
  commands,
}: {
  readonly commands: StashCommands;
}) {
  const { stash, busy, confirm, cancel } = commands.dropping;
  if (stash === undefined) return null;
  return (
    <PersistentNotification>
      <Confirmation
        action="Drop"
        busy={busy}
        className="px-3 py-2"
        onCancel={cancel}
        onConfirm={confirm}
        title={`Drop “${stash.name}”?`}
      >
        Its saved changes will be deleted.
      </Confirmation>
    </PersistentNotification>
  );
}

function stashLabel(stash: RepositoryStash) {
  return [
    stash.name,
    ...(stash.auto ? ["saved by checkout"] : []),
    ...(stash.branch === null ? [] : [`on ${stash.branch}`]),
  ].join(", ");
}
