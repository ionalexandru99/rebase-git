import { Popover } from "@base-ui/react/popover";
import { IconSearch, IconX } from "@tabler/icons-react";
import { type KeyboardEvent, useId, useRef, useState } from "react";
import { Button } from "#web/components/ui/button";
import { Input } from "#web/components/ui/input";
import type { RepositoryHistorySearch } from "#web/domain/repository-history/history-search.contract";
import { HistorySearchResults } from "#web/features/history-search/components/history-search-results";
import { useRepositoryHistorySearch } from "#web/features/history-search/hooks/use-repository-history-search";
import { useRepositoryHistorySearchModel } from "#web/features/history-search/hooks/use-repository-history-search-model";
import type { RepositoryHistorySearchModel } from "#web/features/history-search/repository-history-search-model.contract";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/repository-history-reader.contract";

export function RepositoryHistorySearchControls({
  reader,
  snapshot,
  onNavigate,
  offline = false,
}: {
  readonly reader: RepositoryHistorySearch;
  readonly snapshot: RepositoryHistorySnapshot;
  readonly onNavigate: (oid: string, signal: AbortSignal) => Promise<void>;
  readonly offline?: boolean;
}) {
  const model = useRepositoryHistorySearchModel(
    reader,
    snapshot.historyRevision,
    onNavigate,
  );
  return (
    <RepositoryHistorySearchView
      model={model}
      snapshot={snapshot}
      offline={offline}
    />
  );
}

export function RepositoryHistorySearchView({
  model,
  snapshot,
  offline = false,
}: {
  readonly model: RepositoryHistorySearchModel | undefined;
  readonly snapshot: RepositoryHistorySnapshot;
  readonly offline?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const [opened, setOpened] = useState(false);
  const search = useRepositoryHistorySearch(model);
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
          className="h-7 pr-7 pl-7 text-[.85rem] md:text-[.85rem]"
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
            className="absolute inset-y-0 right-0 grid w-7 place-items-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-primary"
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
                className="w-[min(36rem,calc(100vw-1rem))] rounded-md border border-border bg-popover text-popover-foreground shadow-xl outline-none"
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
                    <p className="px-2 py-3 text-[.85rem] text-muted-foreground">
                      No matches.
                    </p>
                  ) : null}
                  {search.error === undefined ? null : (
                    <div className="px-2 py-2 text-[.85rem]">
                      <p role="alert">{search.error}</p>
                      <Button
                        className="mt-1 text-[.85rem] sm:text-[.85rem]"
                        onClick={search.retry}
                        size="xs"
                        variant="ghost"
                      >
                        Retry search
                      </Button>
                    </div>
                  )}
                </div>
                {offline || !complete ? (
                  <div className="border-border border-t px-3 py-2 text-[.85rem] text-muted-foreground">
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
