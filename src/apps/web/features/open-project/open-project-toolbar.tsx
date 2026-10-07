import { IconFolder, IconSearch } from "@tabler/icons-react";
import type { JSX, KeyboardEvent, RefObject } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";

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
    <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <h1 className="text-title leading-tight font-semibold tracking-[-.018em]">
          Open project
        </h1>
        <Button
          className="h-8 gap-[.45rem] px-3 text-control font-medium sm:h-8"
          disabled={!browseAvailable}
          onClick={onBrowse}
          type="button"
          variant="outline"
        >
          <IconFolder aria-hidden="true" />
          Browse files
        </Button>
      </div>
      <div className="sticky top-0 z-10 bg-repository pt-1 pb-3">
        <div className="relative min-w-0">
          <IconSearch
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-activedescendant={activeDescendant}
            aria-controls="open-project-results"
            aria-label="Search repositories"
            autoComplete="off"
            autoFocus
            className="h-8 pl-9 sm:h-8"
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search, or paste a Git URL"
            ref={inputRef}
            type="search"
            value={query}
          />
        </div>
      </div>
    </>
  );
}
