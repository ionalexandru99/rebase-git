import { IconSearch } from "@tabler/icons-react";
import { type JSX, type KeyboardEvent, useRef, useState } from "react";
import {
  findKeyboardShortcutConflict,
  keyboardShortcutCommands,
  keyboardShortcutFromInput,
  keyboardShortcutKeys,
  keyboardShortcutLabel,
  keyboardShortcutValidationError,
  keyboardShortcutWarning,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type {
  KeyboardShortcutBinding,
  KeyboardShortcutBindings,
  KeyboardShortcutClient,
  KeyboardShortcutCommand,
  KeyboardShortcutGroup,
  KeyboardShortcutPlatform,
  KeyboardShortcutStore,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts.contract";
import {
  type FixedKeyboardShortcut,
  fixedKeyboardShortcuts,
} from "#web/features/settings/fixed-keyboard-shortcuts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "#web-ui/components/ui/alert-dialog";
import { Button } from "#web-ui/components/ui/button";
import { Input } from "#web-ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#web-ui/components/ui/popover";
import { useKeyboardShortcuts } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";

const groups: readonly KeyboardShortcutGroup[] = [
  "Navigation",
  "Search and lists",
  "Folder picker",
];

export function KeyboardShortcutsSettings(): JSX.Element {
  const { bindings, client, modifiedCommandIds, platform, store } =
    useKeyboardShortcuts();
  const [query, setQuery] = useState("");
  const [confirmingResetAll, setConfirmingResetAll] = useState(false);
  const matchesQuery = queryMatcher(query);
  const visibleCommands = keyboardShortcutCommands.filter((command) =>
    matchesQuery(
      command.label,
      keyboardShortcutLabel(bindings[command.id], platform),
    ),
  );
  const visibleFixedShortcuts = fixedKeyboardShortcuts.filter((shortcut) =>
    matchesQuery(shortcut.label, shortcut.keys.join(" ")),
  );

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pt-10 pb-16 sm:px-8 sm:pt-12">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Keyboard shortcuts
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Move through Rebase without leaving the keyboard.
        </p>
      </header>

      <div className="mt-8 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <IconSearch
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Search keyboard shortcuts"
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shortcuts..."
            value={query}
          />
        </div>
        <Button
          disabled={modifiedCommandIds.length === 0}
          onClick={() => setConfirmingResetAll(true)}
          size="sm"
          type="button"
          variant="outline"
        >
          Reset all
        </Button>
      </div>

      {groups.map((group) => {
        const commands = visibleCommands.filter(
          (command) => command.group === group,
        );
        const fixedShortcuts = visibleFixedShortcuts.filter(
          (shortcut) => shortcut.group === group,
        );
        return commands.length === 0 && fixedShortcuts.length === 0 ? null : (
          <section
            aria-labelledby={`keyboard-shortcuts-${groupId(group)}`}
            className="mt-10"
            key={group}
          >
            <h2
              className="text-lg font-semibold"
              id={`keyboard-shortcuts-${groupId(group)}`}
            >
              {group}
            </h2>
            <div className="mt-3 space-y-1">
              {commands.map((command) => (
                <ShortcutRow
                  binding={bindings[command.id]}
                  bindings={bindings}
                  client={client}
                  command={command}
                  key={command.id}
                  modified={modifiedCommandIds.includes(command.id)}
                  platform={platform}
                  store={store}
                />
              ))}
              {fixedShortcuts.map((shortcut) => (
                <FixedShortcutRow
                  key={`${shortcut.label}:${shortcut.keys.join("+")}`}
                  shortcut={shortcut}
                />
              ))}
            </div>
          </section>
        );
      })}

      {visibleCommands.length === 0 && visibleFixedShortcuts.length === 0 ? (
        <p className="mt-10 text-sm text-muted-foreground">
          No keyboard shortcuts found.
        </p>
      ) : null}

      <AlertDialog
        onOpenChange={setConfirmingResetAll}
        open={confirmingResetAll}
      >
        <AlertDialogContent>
          <AlertDialogTitle>Reset all keyboard shortcuts?</AlertDialogTitle>
          <AlertDialogDescription>
            Restore every shortcut to its Rebase default.
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={store.resetAll}>
              Reset all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ShortcutRow({
  binding,
  bindings,
  client,
  command,
  modified,
  platform,
  store,
}: {
  readonly binding: KeyboardShortcutBinding | null;
  readonly bindings: KeyboardShortcutBindings;
  readonly client: KeyboardShortcutClient;
  readonly command: KeyboardShortcutCommand;
  readonly modified: boolean;
  readonly platform: KeyboardShortcutPlatform;
  readonly store: KeyboardShortcutStore;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<KeyboardShortcutBinding | null>(binding);
  const [validationError, setValidationError] = useState<string>();
  const captureRef = useRef<HTMLButtonElement>(null);
  const conflict =
    draft === null
      ? undefined
      : findKeyboardShortcutConflict(bindings, command.id, draft);
  const warning = validationError ?? keyboardShortcutWarning(draft, client);

  const changeOpen = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setDraft(binding);
      setValidationError(undefined);
    }
  };

  const save = () => {
    if (draft !== null) {
      const error = keyboardShortcutValidationError(draft);
      if (error !== undefined) {
        setValidationError(error);
        return;
      }
      if (conflict !== undefined) return;
    }
    store.setBinding(command.id, draft);
    setOpen(false);
  };

  const replace = () => {
    if (draft === null || conflict === undefined) return;
    store.setBinding(command.id, draft, conflict.id);
    setOpen(false);
  };

  return (
    <div className="flex min-h-16 items-center justify-between gap-5 rounded-xl px-3 py-3 hover:bg-accent sm:px-4">
      <div className="min-w-0">
        <span className="text-sm font-medium">{command.label}</span>
        {modified ? (
          <span className="ml-2 font-mono text-[.63rem] text-primary uppercase">
            Modified
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {modified ? (
          <Button
            aria-label={`Reset ${command.label}`}
            onClick={() => store.resetBinding(command.id)}
            size="xs"
            type="button"
            variant="ghost"
          >
            Reset
          </Button>
        ) : null}
        <Popover onOpenChange={changeOpen} open={open}>
          <PopoverTrigger
            aria-label={`Edit ${command.label} shortcut`}
            className="flex min-h-8 min-w-14 items-center justify-center gap-1.5 rounded-lg border border-transparent px-1.5 outline-none hover:border-border hover:bg-background/45 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-expanded:border-ring/50 aria-expanded:bg-background/45"
          >
            <ShortcutKeys keys={keyboardShortcutKeys(binding, platform)} />
          </PopoverTrigger>
          <PopoverContent
            aria-label={`Edit ${command.label} shortcut`}
            initialFocus={captureRef}
          >
            <h3 className="text-sm font-semibold">{command.label}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Press a new shortcut.
            </p>
            <button
              className="mt-3 flex min-h-14 w-full items-center justify-center gap-1.5 rounded-md border border-input bg-input/20 px-3 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              onKeyDown={(event) =>
                captureShortcut(
                  event,
                  platform,
                  setDraft,
                  setValidationError,
                  () => setOpen(false),
                )
              }
              ref={captureRef}
              type="button"
            >
              <ShortcutKeys
                emptyLabel="Press keys"
                keys={keyboardShortcutKeys(draft, platform)}
              />
            </button>
            {conflict !== undefined ? (
              <p className="mt-3 text-xs text-muted-foreground" role="status">
                <span className="font-medium text-status-connecting">
                  Already assigned.
                </span>{" "}
                {conflict.label} currently uses{" "}
                {keyboardShortcutLabel(draft, platform)}.
              </p>
            ) : warning !== undefined ? (
              <p className="mt-3 text-xs text-status-connecting" role="status">
                {warning}
              </p>
            ) : null}
            <div className="mt-4 flex items-center justify-between gap-2">
              <Button
                onClick={() => {
                  setDraft(null);
                  setValidationError(undefined);
                }}
                size="sm"
                type="button"
                variant="destructive"
              >
                Clear
              </Button>
              <div className="flex gap-2">
                <Button
                  onClick={() => setOpen(false)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Cancel
                </Button>
                <Button
                  onClick={conflict === undefined ? save : replace}
                  size="sm"
                  type="button"
                >
                  {conflict === undefined ? "Save" : "Replace"}
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}

function FixedShortcutRow({
  shortcut,
}: {
  readonly shortcut: FixedKeyboardShortcut;
}): JSX.Element {
  return (
    <div className="flex min-h-16 items-center justify-between gap-5 rounded-xl px-3 py-3 sm:px-4">
      <span className="text-sm font-medium">{shortcut.label}</span>
      <span className="flex min-h-8 shrink-0 items-center gap-1.5 px-1.5">
        <ShortcutKeys keys={shortcut.keys} />
      </span>
    </div>
  );
}

function ShortcutKeys({
  emptyLabel = "Unassigned",
  keys,
}: {
  readonly emptyLabel?: string;
  readonly keys: readonly string[];
}): JSX.Element {
  return keys.length === 0 ? (
    <span className="text-xs text-muted-foreground">{emptyLabel}</span>
  ) : (
    <span className="contents">
      {keys.map((key) => (
        <kbd
          className="min-w-7 rounded-md border border-border bg-secondary px-2 py-1 text-center font-sans text-xs font-medium text-secondary-foreground shadow-sm"
          key={key}
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}

function captureShortcut(
  event: KeyboardEvent<HTMLButtonElement>,
  platform: KeyboardShortcutPlatform,
  setDraft: (binding: KeyboardShortcutBinding | null) => void,
  setValidationError: (error: string | undefined) => void,
  cancel: () => void,
) {
  if (event.key === "Tab") return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    cancel();
    return;
  }
  if (event.key === "Backspace" || event.key === "Delete") {
    setDraft(null);
    setValidationError(undefined);
    return;
  }
  const binding = keyboardShortcutFromInput(event, platform);
  if (binding === undefined) return;
  setDraft(binding);
  setValidationError(keyboardShortcutValidationError(binding));
}

function queryMatcher(query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return (...candidates: readonly string[]) =>
    normalizedQuery.length === 0 ||
    candidates.some((candidate) =>
      candidate.toLocaleLowerCase().includes(normalizedQuery),
    );
}

function groupId(group: KeyboardShortcutGroup): string {
  return group.toLocaleLowerCase().replaceAll(" ", "-");
}
