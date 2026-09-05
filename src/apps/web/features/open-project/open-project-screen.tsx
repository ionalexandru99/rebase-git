import {
  IconChevronRight,
  IconFolderPlus,
  IconSearch,
} from "@tabler/icons-react";
import {
  type JSX,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { matchesKeyboardShortcut } from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type {
  OpenProjectRepository,
  OpenProjectScreenProps,
} from "#web/features/open-project/open-project.contract";
import {
  catalogRepositoryItems,
  filterOpenProjectEnvironments,
  keyboardRepositoryItems,
  recentRepositoryItems,
} from "#web/features/open-project/open-project-state";
import { useKeyboardShortcuts } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";
import { OpenProjectToolbar } from "#web-ui/features/open-project/open-project-toolbar";
import { RecentRepositories } from "#web-ui/features/open-project/recent-repositories";
import { RepositoryEnvironmentGroup } from "#web-ui/features/open-project/repository-environment-group";
import { openProjectItemId } from "#web-ui/features/open-project/repository-row";

export function OpenProjectScreen({
  active,
  browseAvailable,
  environments,
  expandedEnvironmentIds,
  onBrowse,
  onEnvironmentOpenChange,
  onOpenRepository,
  onOpenSettings,
}: OpenProjectScreenProps): JSX.Element {
  const { bindings, platform } = useKeyboardShortcuts();
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const filteredEnvironments = useMemo(
    () => filterOpenProjectEnvironments(environments, query),
    [environments, query],
  );
  const recentItems = useMemo(
    () => recentRepositoryItems(filteredEnvironments),
    [filteredEnvironments],
  );
  const catalogItems = useMemo(
    () => catalogRepositoryItems(filteredEnvironments, expandedEnvironmentIds),
    [expandedEnvironmentIds, filteredEnvironments],
  );
  const keyboardItems = useMemo(
    () => keyboardRepositoryItems(recentItems, catalogItems),
    [catalogItems, recentItems],
  );
  const hasRepositories = environments.some(
    (environment) => environment.repositories.length > 0,
  );
  const hasMatches = filteredEnvironments.some(
    (environment) => environment.repositories.length > 0,
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (
      activeKey !== undefined &&
      !keyboardItems.some((item) => item.key === activeKey)
    ) {
      setActiveKey(undefined);
    }
  }, [activeKey, keyboardItems]);

  useEffect(() => {
    if (activeKey === undefined) return;
    document
      .getElementById(openProjectItemId(activeKey))
      ?.scrollIntoView({ block: "nearest" });
  }, [activeKey]);

  useEffect(() => {
    const focusSearch = (event: globalThis.KeyboardEvent) => {
      if (
        !active ||
        event.defaultPrevented ||
        event.isComposing ||
        !matchesKeyboardShortcut(event, bindings["search.focus"], platform)
      ) {
        return;
      }

      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };

    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, [active, bindings, platform]);

  const openRepository = useCallback(
    (repository: OpenProjectRepository) => onOpenRepository(repository),
    [onOpenRepository],
  );

  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && query.length > 0) {
      event.preventDefault();
      setQuery("");
      setActiveKey(undefined);
      return;
    }

    if (event.key === "Enter") {
      const activeItem = keyboardItems.find((item) => item.key === activeKey);
      if (activeItem === undefined) return;
      event.preventDefault();
      openRepository(activeItem.repository);
      return;
    }

    const direction = keyboardDirection(event.key);
    if (direction === 0 || keyboardItems.length === 0) return;

    event.preventDefault();
    const activeIndex = keyboardItems.findIndex(
      (item) => item.key === activeKey,
    );
    const nextIndex =
      activeIndex < 0
        ? direction > 0
          ? 0
          : keyboardItems.length - 1
        : (activeIndex + direction + keyboardItems.length) %
          keyboardItems.length;
    setActiveKey(keyboardItems[nextIndex]?.key);
  };

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery);
    setActiveKey(undefined);
  };

  return (
    <main
      aria-label="Open project"
      className="h-full overflow-x-hidden overflow-y-auto bg-repository"
    >
      <div className="mx-auto w-[min(56rem,calc(100%-3rem))] pt-16 pb-20 max-[900px]:w-[calc(100%-2rem)] max-[650px]:pt-10">
        <h1 className="mb-6 text-xl leading-tight font-semibold tracking-[-.018em]">
          Open project
        </h1>
        <OpenProjectToolbar
          activeDescendant={
            activeKey === undefined ? undefined : openProjectItemId(activeKey)
          }
          browseAvailable={browseAvailable}
          inputRef={inputRef}
          onBrowse={onBrowse}
          onChange={handleQueryChange}
          onKeyDown={handleSearchKeyDown}
          query={query}
        />
        {!hasRepositories ? (
          <ColdStart browseAvailable={browseAvailable} onBrowse={onBrowse} />
        ) : hasMatches ? (
          <div
            aria-label="Repositories"
            id="open-project-results"
            role="listbox"
          >
            <RecentRepositories
              activeKey={activeKey}
              items={recentItems}
              onActivate={setActiveKey}
              onOpen={openRepository}
              onOpenSettings={onOpenSettings}
            />
            <div className="mt-[2.4rem] space-y-[1.2rem]">
              {filteredEnvironments
                .filter((environment) => environment.repositories.length > 0)
                .map((environment) => (
                  <RepositoryEnvironmentGroup
                    activeKey={activeKey}
                    environment={environment}
                    key={environment.id}
                    onActivate={setActiveKey}
                    onOpenChange={(open) =>
                      onEnvironmentOpenChange(environment.id, open)
                    }
                    onOpenRepository={openRepository}
                    onOpenSettings={onOpenSettings}
                    open={expandedEnvironmentIds.has(environment.id)}
                  />
                ))}
            </div>
          </div>
        ) : (
          <EmptySearch />
        )}
      </div>
    </main>
  );
}

function ColdStart({
  browseAvailable,
  onBrowse,
}: {
  readonly browseAvailable: boolean;
  readonly onBrowse: () => void;
}) {
  return (
    <button
      className="mt-[1.35rem] grid min-h-16 w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2.5 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-45"
      disabled={!browseAvailable}
      onClick={onBrowse}
      type="button"
    >
      <span className="grid size-9 place-items-center rounded-[.45rem] bg-secondary text-secondary-foreground">
        <IconFolderPlus aria-hidden="true" className="size-4" />
      </span>
      <span className="min-w-0">
        <strong className="block truncate text-[.82rem] font-semibold">
          Open a repository from your file system
        </strong>
        <span className="block truncate text-[.72rem] text-muted-foreground">
          Choose a folder containing a Git repository
        </span>
      </span>
      <IconChevronRight
        aria-hidden="true"
        className="size-4 text-muted-foreground"
      />
    </button>
  );
}

function EmptySearch() {
  return (
    <div className="flex min-h-42 flex-col items-center justify-center text-center">
      <IconSearch
        aria-hidden="true"
        className="mb-3 size-8 text-muted-foreground"
        stroke={1.25}
      />
      <strong className="text-[.82rem] font-semibold">
        No repositories found
      </strong>
      <p className="mt-1 max-w-72 text-[.72rem] text-muted-foreground">
        Browse your file system to open a repository that Rebase does not know
        yet.
      </p>
    </div>
  );
}

function keyboardDirection(key: string): -1 | 0 | 1 {
  if (key === "ArrowDown" || key === "ArrowRight") return 1;
  if (key === "ArrowUp" || key === "ArrowLeft") return -1;
  return 0;
}
