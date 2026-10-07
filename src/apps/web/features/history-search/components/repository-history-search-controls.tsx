import { Popover } from "@base-ui/react/popover";
import {
  IconChevronDown,
  IconCode,
  IconFolder,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { HistorySearchResults } from "#web/features/history-search/components/history-search-results.tsx";
import {
  type CodeSearchScope,
  type SearchMode,
  useHistorySearch,
} from "#web/features/history-search/use-history-search.ts";
import type { HistorySnapshot } from "#web/features/repository-history/history-worker-protocol.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";

const modes = [
  { value: "Commits", label: "Commits", Icon: IconSearch },
  { value: "Code", label: "Code", Icon: IconCode },
] as const;

export function RepositoryHistorySearchControls({
  history,
  snapshot,
  onNavigate,
  code,
  offline = false,
}: {
  readonly history: RepositoryHistory;
  readonly snapshot: HistorySnapshot;
  readonly onNavigate: (oid: string, signal: AbortSignal) => Promise<void>;
  readonly code: CodeSearchScope;
  readonly offline?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const [opened, setOpened] = useState(false);
  const search = useHistorySearch(history, snapshot.revision, onNavigate, code);
  const codeMode = search.mode === "Code";
  const running = codeMode && search.loading;
  const open = () => {
    setOpened(true);
    input.current?.focus();
  };
  const close = () => {
    setOpened(false);
    input.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
    if (
      event.key === "Enter" &&
      event.target === input.current &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) search.previous();
      else search.next();
      if (codeMode) setOpened(false);
    }
  };
  const busy = search.navigating || (!codeMode && search.loading);
  const showPopup =
    opened &&
    (codeMode ||
      (search.text.trim() !== "" &&
        (!search.loading || search.commits.length > 0)));
  const complete =
    search.text.trim() === ""
      ? snapshot.synchronization === "complete"
      : search.complete;
  const Mode = codeMode ? IconCode : IconSearch;
  const placeholder = codeMode ? "Search code" : "Search history";

  return (
    <>
      <div className="relative min-w-32 max-w-64 flex-1">
        <DropdownMenu
          onOpenChangeComplete={(menuOpen) => {
            if (!menuOpen) input.current?.focus();
          }}
        >
          <DropdownMenuTrigger
            aria-label={`Search mode, ${search.mode}`}
            className="absolute inset-y-0 left-0 z-10 flex items-center gap-0.5 rounded-l-control pr-1 pl-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary data-popup-open:text-foreground"
          >
            <Mode
              aria-hidden="true"
              className={`size-3.5 ${codeMode ? "text-primary" : ""}`}
            />
            <IconChevronDown aria-hidden="true" className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-36">
            <DropdownMenuRadioGroup
              onValueChange={(mode: SearchMode) => {
                search.setMode(mode);
                setOpened(true);
              }}
              value={search.mode}
            >
              {modes.map(({ value, label, Icon }) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  <span className="flex items-center gap-2">
                    <Icon aria-hidden="true" />
                    {label}
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Input
          aria-controls={showPopup ? resultsId : undefined}
          aria-expanded={showPopup}
          aria-busy={busy || running}
          aria-haspopup="dialog"
          aria-label={placeholder}
          className={`h-7 pl-11 text-control ${codeMode && search.selected >= 0 ? "pr-16" : "pr-7"}`}
          maxLength={256}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            search.setText(event.target.value);
            setOpened(true);
          }}
          onClick={() => setOpened(true)}
          placeholder={placeholder}
          ref={input}
          type="text"
          role="searchbox"
          value={search.text}
        />
        <span className="absolute inset-y-0 right-0 flex items-center">
          {codeMode && search.selected >= 0 ? (
            <span className="text-meta text-muted-foreground">
              {search.selected + 1}/{search.commits.length}
            </span>
          ) : null}
          {search.text === "" ? null : (
            <button
              type="button"
              aria-label="Clear history search"
              className="grid h-full w-7 place-items-center rounded-r-control text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary"
              onClick={() => {
                search.setText("");
                open();
              }}
            >
              <IconX aria-hidden="true" className="size-3.5" />
            </button>
          )}
        </span>
      </div>
      <span className="sr-only" role="status">
        {search.loading
          ? "Searching"
          : search.navigating
            ? "Opening result"
            : ""}
      </span>
      {showPopup ? (
        <Popover.Root open onOpenChange={setOpened}>
          <Popover.Portal>
            <Popover.Positioner
              anchor={input}
              align="end"
              className="z-50"
              sideOffset={5}
            >
              <Popover.Popup
                aria-label="History search results"
                className="w-[min(36rem,calc(100vw-1rem))] elevation-menu outline-none"
                finalFocus={input}
                id={resultsId}
                initialFocus={false}
                onKeyDown={onKeyDown}
              >
                {codeMode ? (
                  <div className="relative border-border border-b p-2">
                    <IconFolder
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 left-4 size-3.5 -translate-y-1/2 text-muted-foreground"
                    />
                    <Input
                      aria-label="Path"
                      className="h-7 pl-7 text-control"
                      maxLength={4_096}
                      onChange={(event) => search.setPath(event.target.value)}
                      placeholder="All files"
                      type="text"
                      value={search.path}
                    />
                  </div>
                ) : null}
                <HistorySearchResults
                  key={`${search.mode}\0${search.text}\0${search.path}`}
                  commits={search.commits}
                  files={search.files}
                  selected={search.selected}
                  busy={busy}
                  onNavigate={search.navigate}
                  onLoadMore={search.loadMore}
                />

                <div aria-busy={busy}>
                  {!busy &&
                  !running &&
                  search.error === undefined &&
                  search.text.trim() !== "" &&
                  search.cursor === undefined &&
                  search.commits.length === 0 ? (
                    <p className="px-2 py-3 text-body text-muted-foreground">
                      No matches.
                    </p>
                  ) : null}
                  {search.error === undefined ? null : (
                    <div className="px-2 py-2 text-body">
                      <p role="alert">{search.error}</p>
                      <Button
                        className="mt-1 text-control"
                        onClick={search.retry}
                        size="xs"
                        variant="ghost"
                      >
                        Retry
                      </Button>
                    </div>
                  )}
                </div>
                {search.progress === undefined ? null : (
                  <div className="flex items-center gap-3 border-border border-t py-1 pr-1 pl-3">
                    <progress
                      aria-label="Code search progress"
                      className="h-0.5 flex-1 appearance-none overflow-hidden rounded-full bg-border [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-border [&::-webkit-progress-value]:bg-primary"
                      max={100}
                      value={search.progress}
                    />
                    <Button
                      className="text-control"
                      onClick={search.stop}
                      size="xs"
                      variant="ghost"
                    >
                      Stop
                    </Button>
                  </div>
                )}
                {!codeMode && (offline || !complete) ? (
                  <div className="border-border border-t px-3 py-2 text-body text-muted-foreground">
                    {[
                      offline ? "Offline" : undefined,
                      !complete ? "Partial results" : undefined,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                ) : null}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ) : null}
    </>
  );
}
