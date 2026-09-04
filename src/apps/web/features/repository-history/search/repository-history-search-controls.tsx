import { Popover } from "@base-ui/react/popover";
import {
  IconArrowDown,
  IconArrowUp,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import {
  type KeyboardEvent,
  type Ref,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { RepositoryHistorySnapshot } from "#web/features/repository-history/repository-history-reader.contract";
import { historySearchPageSize } from "#web/features/repository-history/search/read-next-history-search-page";
import type { RepositoryHistorySearch } from "#web/features/repository-history/search/repository-history-search.contract";
import type {
  RepositoryHistorySearchActions,
  RepositoryHistorySearchBindings,
} from "#web/features/repository-history/search/repository-history-search-controls.contract";
import { useRepositoryHistorySearch } from "#web/features/repository-history/search/use-repository-history-search";
import { Button } from "#web-ui/components/ui/button";
import { Input } from "#web-ui/components/ui/input";

export function RepositoryHistorySearchControls({
  reader,
  snapshot,
  contentRevision,
  onNavigate,
  bindings = {},
  offline = false,
  ref,
}: {
  readonly reader: RepositoryHistorySearch;
  readonly snapshot: RepositoryHistorySnapshot;
  readonly contentRevision: number;
  readonly onNavigate: (oid: string) => Promise<void>;
  readonly bindings?: RepositoryHistorySearchBindings;
  readonly offline?: boolean;
  readonly ref?: Ref<RepositoryHistorySearchActions>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const resultsId = useId();
  const [opened, setOpened] = useState(false);
  const search = useRepositoryHistorySearch(
    reader,
    contentRevision,
    onNavigate,
  );
  const open = () => {
    setOpened(true);
    input.current?.focus();
  };
  const close = () => {
    setOpened(false);
    input.current?.focus();
  };
  useImperativeHandle(ref, () => ({
    open,
    close,
    next: search.next,
    previous: search.previous,
  }));
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
  const windowStart =
    Math.floor(Math.max(0, search.selected) / historySearchPageSize) *
    historySearchPageSize;
  const visible = search.commits.slice(
    windowStart,
    windowStart + historySearchPageSize,
  );
  const busy = search.loading || search.navigating;
  const indexedCount = search.count || snapshot.synchronizedCommitCount || 0;
  const complete =
    search.text.trim() === ""
      ? snapshot.synchronization === "complete"
      : search.complete;

  return (
    <Popover.Root open={opened} onOpenChange={setOpened}>
      <div className="relative min-w-32 max-w-64 flex-1">
        <IconSearch
          aria-hidden="true"
          className="pointer-events-none absolute top-1.5 left-2 size-3.5 text-muted-foreground"
        />
        <Input
          aria-controls={opened ? resultsId : undefined}
          aria-expanded={opened}
          aria-haspopup="dialog"
          aria-keyshortcuts={bindings.open?.ariaKeyShortcuts}
          aria-label="Search history"
          className="h-7 pr-7 pl-7 text-xs md:text-xs"
          maxLength={256}
          onKeyDown={onKeyDown}
          onChange={(event) => {
            search.setText(event.target.value);
            setOpened(true);
          }}
          onClick={() => setOpened(true)}
          placeholder="Search history"
          ref={input}
          title={
            bindings.open?.shortcut === undefined
              ? "Search history"
              : `Search history (${bindings.open.shortcut})`
          }
          type="search"
          value={search.text}
        />
        {search.text === "" ? null : (
          <Button
            aria-label="Clear history search"
            className="absolute top-0 right-0 size-7"
            onClick={() => {
              search.setText("");
              open();
            }}
            size="icon-xs"
            variant="ghost"
          >
            <IconX />
          </Button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Positioner
          anchor={input}
          align="end"
          className="z-50"
          sideOffset={5}
        >
          <Popover.Popup
            aria-label="History search results"
            className="w-[min(28rem,calc(100vw-1rem))] rounded-md border border-border bg-popover text-popover-foreground shadow-xl outline-none"
            finalFocus={input}
            id={resultsId}
            initialFocus={false}
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-1 border-border border-b px-2 py-1.5">
              <span className="mr-auto text-xs tabular-nums" role="status">
                {search.loading
                  ? "Searching cached history…"
                  : search.navigating
                    ? "Opening result…"
                    : search.text.trim() === ""
                      ? "Search cached history"
                      : `${search.commits.length}${search.cursor === undefined ? "" : "+"} ${search.commits.length === 1 && search.cursor === undefined ? "match" : "matches"}`}
                {search.selected >= 0 ? ` · Result ${search.selected + 1}` : ""}
              </span>
              <Button
                aria-keyshortcuts={bindings.previous?.ariaKeyShortcuts}
                aria-label="Previous search result"
                disabled={!search.canPrevious}
                onClick={search.previous}
                size="icon-xs"
                title={bindings.previous?.shortcut}
                variant="ghost"
              >
                <IconArrowUp />
              </Button>
              <Button
                aria-keyshortcuts={bindings.next?.ariaKeyShortcuts}
                aria-label="Next search result"
                disabled={!search.canNext}
                onClick={search.next}
                size="icon-xs"
                title={bindings.next?.shortcut}
                variant="ghost"
              >
                <IconArrowDown />
              </Button>
              <Button
                aria-label="Close history search"
                onClick={close}
                size="icon-xs"
                title="Escape"
                variant="ghost"
              >
                <IconX />
              </Button>
            </div>
            <div className="max-h-72 overflow-y-auto p-1" aria-busy={busy}>
              {visible.map((commit, offset) => (
                <Button
                  aria-current={
                    search.selected === windowStart + offset
                      ? "true"
                      : undefined
                  }
                  className="h-auto w-full justify-start gap-2 px-2 py-2 text-left"
                  disabled={busy}
                  key={commit.oid}
                  onClick={() => search.navigate(windowStart + offset)}
                  variant="ghost"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs">
                      {commit.subject}
                    </span>
                    <span
                      className="mt-0.5 block truncate text-[10px] text-muted-foreground"
                      title={`${commit.author.name} <${commit.author.email}>`}
                    >
                      {commit.author.name} · {commit.author.email}
                    </span>
                  </span>
                  <code className="shrink-0 text-[10px] text-muted-foreground">
                    {commit.oid.slice(0, 8)}
                  </code>
                </Button>
              ))}
              {search.text.trim() === "" ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  Find a commit by hash, subject, author, email, or ref name.
                </p>
              ) : null}
              {!busy &&
              search.error === undefined &&
              search.text.trim() !== "" &&
              search.commits.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">
                  No matches in cached history.
                </p>
              ) : null}
              {search.error === undefined ? null : (
                <div className="px-2 py-2 text-xs">
                  <p role="alert">{search.error}</p>
                  <Button
                    className="mt-1"
                    onClick={search.retry}
                    size="xs"
                    variant="ghost"
                  >
                    Retry search
                  </Button>
                </div>
              )}
            </div>
            <div className="border-border border-t px-3 py-2 text-[10px] text-muted-foreground">
              {offline ? "Offline · " : ""}
              {complete
                ? `${indexedCount.toLocaleString()} commits indexed`
                : `Partial results · ${indexedCount.toLocaleString()} commits indexed`}
              <span className="block">Commit bodies are not searched.</span>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
