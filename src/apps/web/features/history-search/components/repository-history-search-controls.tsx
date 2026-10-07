import { Popover } from "@base-ui/react/popover";
import { IconSearch, IconX } from "@tabler/icons-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import { HistorySearchResults } from "#web/features/history-search/components/history-search-results.tsx";
import { useHistorySearch } from "#web/features/history-search/use-history-search.ts";
import type { HistorySnapshot } from "#web/features/repository-history/history-worker-protocol.ts";
import type { RepositoryHistory } from "#web/features/repository-history/repository-history.ts";

export function RepositoryHistorySearchControls({
  history,
  snapshot,
  onNavigate,
  offline = false,
}: {
  readonly history: RepositoryHistory;
  readonly snapshot: HistorySnapshot;
  readonly onNavigate: (oid: string, signal: AbortSignal) => Promise<void>;
  readonly offline?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const [opened, setOpened] = useState(false);
  const search = useHistorySearch(history, snapshot.revision, onNavigate);
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
    }
  };
  const busy = search.loading || search.navigating;
  const showPopup =
    opened &&
    search.text.trim() !== "" &&
    (!search.loading || search.commits.length > 0);
  const complete =
    search.text.trim() === ""
      ? snapshot.synchronization === "complete"
      : search.complete;

  return (
    <>
      <div className="relative min-w-32 max-w-64 flex-1">
        <IconSearch
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-controls={showPopup ? resultsId : undefined}
          aria-expanded={showPopup}
          aria-busy={busy}
          aria-haspopup="dialog"
          aria-label="Search history"
          className="h-7 pr-7 pl-7 text-control"
          maxLength={256}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            search.setText(event.target.value);
            setOpened(true);
          }}
          onClick={() => setOpened(true)}
          placeholder="Search history"
          ref={input}
          type="text"
          role="searchbox"
          value={search.text}
        />
        {search.text === "" ? null : (
          <button
            type="button"
            aria-label="Clear history search"
            className="absolute inset-y-0 right-0 grid w-7 place-items-center rounded-r-control text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary"
            onClick={() => {
              search.setText("");
              open();
            }}
          >
            <IconX aria-hidden="true" className="size-3.5" />
          </button>
        )}
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
                <HistorySearchResults
                  key={search.text}
                  commits={search.commits}
                  selected={search.selected}
                  busy={busy}
                  onNavigate={search.navigate}
                  onLoadMore={search.loadMore}
                />
                <div aria-busy={busy}>
                  {!busy &&
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
                {offline || !complete ? (
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
