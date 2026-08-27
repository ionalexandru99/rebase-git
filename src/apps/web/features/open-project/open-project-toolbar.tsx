import { IconFolder, IconSearch } from "@tabler/icons-react";
import type { JSX, KeyboardEvent, RefObject } from "react";
import {
  keyboardShortcutAria,
  keyboardShortcutLabel,
  keyboardShortcutTitle,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import { Button } from "#web-ui/components/ui/button";
import { Input } from "#web-ui/components/ui/input";
import { useKeyboardShortcuts } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";

export function OpenProjectToolbar({
  activeDescendant,
  browseAvailable,
  inputRef,
  onBrowse,
  onChange,
  onKeyDown,
  query,
}: {
  readonly activeDescendant: string | undefined;
  readonly browseAvailable: boolean;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly onBrowse: () => void;
  readonly onChange: (query: string) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  readonly query: string;
}): JSX.Element {
  const { bindings, platform } = useKeyboardShortcuts();
  const focusSearchShortcut = bindings["search.focus"];
  const browseShortcut = bindings["projects.browseRepository"];
  const focusSearchAria = keyboardShortcutAria(focusSearchShortcut, platform);

  return (
    <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] gap-2.5 bg-repository pt-1 pb-3 max-[650px]:grid-cols-1">
      <div className="relative min-w-0">
        <IconSearch
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-activedescendant={activeDescendant}
          aria-controls="open-project-results"
          aria-keyshortcuts={`${focusSearchAria === undefined ? "" : `${focusSearchAria} `}ArrowUp ArrowDown Enter Escape`}
          aria-label="Search repositories"
          autoComplete="off"
          autoFocus
          className={`h-8 bg-white/[.04] pl-9 sm:h-8 ${focusSearchShortcut === null ? "" : "pr-15"}`}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search repositories"
          ref={inputRef}
          type="search"
          value={query}
        />
        {focusSearchShortcut === null ? null : (
          <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[.67rem] text-muted-foreground/65">
            {keyboardShortcutLabel(focusSearchShortcut, platform)}
          </kbd>
        )}
      </div>
      <Button
        aria-keyshortcuts={keyboardShortcutAria(browseShortcut, platform)}
        className="h-8 gap-[.45rem] px-3 text-[.8rem] font-medium sm:h-8 max-[650px]:w-full"
        disabled={!browseAvailable}
        onClick={onBrowse}
        title={keyboardShortcutTitle("Browse files", browseShortcut, platform)}
        type="button"
      >
        <IconFolder aria-hidden="true" />
        Browse files
      </Button>
    </div>
  );
}
