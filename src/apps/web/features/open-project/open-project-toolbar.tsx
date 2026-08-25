import { IconFolder, IconSearch } from "@tabler/icons-react";
import type { JSX, KeyboardEvent, RefObject } from "react";
import { Button } from "#web-ui/components/ui/button";
import { Input } from "#web-ui/components/ui/input";

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
          aria-keyshortcuts="Control+F Meta+F ArrowUp ArrowDown Enter Escape"
          aria-label="Search repositories"
          autoComplete="off"
          autoFocus
          className="h-8 bg-white/[.04] pr-15 pl-9 sm:h-8"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search repositories"
          ref={inputRef}
          type="search"
          value={query}
        />
        <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-[.67rem] text-muted-foreground/65">
          {searchShortcutLabel()}
        </kbd>
      </div>
      <Button
        aria-keyshortcuts="Control+O Meta+O"
        className="h-8 gap-[.45rem] px-3 text-[.8rem] font-medium sm:h-8 max-[650px]:w-full"
        disabled={!browseAvailable}
        onClick={onBrowse}
        title="Browse files (Ctrl/⌘ O)"
        type="button"
      >
        <IconFolder aria-hidden="true" />
        Browse files
      </Button>
    </div>
  );
}

function searchShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl F";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ F" : "Ctrl F";
}
