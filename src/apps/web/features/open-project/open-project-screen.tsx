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
  useRef,
  useState,
} from "react";
import { cloneDestinationId } from "#web/features/open-project/clone-line.tsx";
import {
  HostRepositoriesGroup,
  UrlGroup,
} from "#web/features/open-project/clone-sources.tsx";
import type { OpenProjectRepository } from "#web/features/open-project/open-project-model.ts";
import { OpenProjectToolbar } from "#web/features/open-project/open-project-toolbar.tsx";
import { RecentRepositories } from "#web/features/open-project/recent-repositories.tsx";
import { RepositoryEnvironmentGroup } from "#web/features/open-project/repository-environment-group.tsx";
import { openProjectItemId } from "#web/features/open-project/repository-row.tsx";
import { useOpenProjectResults } from "#web/features/open-project/use-open-project-results.ts";
import { localEnvironment } from "#web/features/project-navigation/local-environment.ts";
import type { ProjectNavigationRepository } from "#web/features/project-navigation/project-navigation.ts";
import { RepositoryFolderPicker } from "#web/features/repository-folder-picker/repository-folder-browser.tsx";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";

const _noHosts = [] as const;

export function OpenProjectScreen({
  onOpenRepository,
  onOpenSettings,
  onRepositoryRemembered,
}: {
  readonly onOpenRepository: (repository: ProjectNavigationRepository) => void;
  readonly onRepositoryRemembered: (
    repository: ProjectNavigationRepository,
  ) => void;
  readonly onOpenSettings: (repositoryId: string) => void;
}): JSX.Element {
  const environmentStatus = useEnvironment().status;
  const browseAvailable = environmentStatus.availability === "available";
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [expandedEnvironmentIds, setExpandedEnvironmentIds] = useState<
    ReadonlySet<string>
  >(() => new Set([localEnvironment.id]));
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string>();
  const [expandedKey, setExpandedKey] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    environments,
    filteredEnvironments,
    recentItems,
    groups,
    pastedUrl,
    keyboardItems,
    hasRepositories,
    hasMatches,
    hasCloneSources,
  } = useOpenProjectResults(query, expandedEnvironmentIds, collapsedGroupIds);

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

  const openRepository = useCallback(
    (repository: OpenProjectRepository) => onOpenRepository(repository),
    [onOpenRepository],
  );
  const openSettings = useCallback(
    (repository: OpenProjectRepository) => onOpenSettings(repository.id),
    [onOpenSettings],
  );
  const onBrowse = () => {
    if (browseAvailable) setFolderPickerOpen(true);
  };
  const setGroupCollapsed = (groupId: string, collapsed: boolean) =>
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (collapsed) next.add(groupId);
      else next.delete(groupId);
      return next;
    });
  const cloneActions = {
    activeKey,
    expandedKey,
    onActivate: setActiveKey,
    onExpand: setExpandedKey,
    onCloned: onRepositoryRemembered,
  };
  const setEnvironmentExpanded = (environmentId: string, open: boolean) =>
    setExpandedEnvironmentIds((current) => {
      const next = new Set(current);
      if (open) next.add(environmentId);
      else next.delete(environmentId);
      return next;
    });

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
      if (!("source" in activeItem)) openRepository(activeItem.repository);
      else if (expandedKey !== activeItem.key) setExpandedKey(activeItem.key);
      else document.getElementById(cloneDestinationId(activeItem.key))?.focus();
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
        {environmentStatus.detail === undefined ? null : (
          <p
            role="status"
            className={`mt-4 text-sm ${environmentStatus.availability === "unavailable" ? "text-status-unavailable" : "text-muted-foreground"}`}
          >
            {environmentStatus.detail}
          </p>
        )}
        {!hasRepositories ? (
          <ColdStart browseAvailable={browseAvailable} onBrowse={onBrowse} />
        ) : null}
        {hasMatches || hasCloneSources ? (
          <div
            aria-label="Repositories"
            id="open-project-results"
            role="listbox"
          >
            {pastedUrl === undefined ? null : (
              <div className="mt-[1.6rem]">
                <UrlGroup source={pastedUrl} {...cloneActions} />
              </div>
            )}
            {hasMatches ? (
              <RecentRepositories
                activeKey={activeKey}
                items={recentItems}
                onActivate={setActiveKey}
                onOpen={openRepository}
                onOpenSettings={openSettings}
              />
            ) : null}
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
                      setEnvironmentExpanded(environment.id, open)
                    }
                    onOpenRepository={openRepository}
                    onOpenSettings={openSettings}
                    open={expandedEnvironmentIds.has(environment.id)}
                  />
                ))}
              {groups.map((group) => (
                <HostRepositoriesGroup
                  group={group}
                  key={group.id}
                  onOpenChange={(open) => setGroupCollapsed(group.id, !open)}
                  open={!collapsedGroupIds.has(group.id)}
                  {...cloneActions}
                />
              ))}
            </div>
          </div>
        ) : hasRepositories ? (
          <EmptySearch />
        ) : null}
      </div>
      <RepositoryFolderPicker
        environments={environments}
        onOpenChange={setFolderPickerOpen}
        onRepositoryOpened={(_, repository) =>
          onRepositoryRemembered(repository)
        }
        open={folderPickerOpen}
      />
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
    </div>
  );
}

function keyboardDirection(key: string): -1 | 0 | 1 {
  if (key === "ArrowDown" || key === "ArrowRight") return 1;
  if (key === "ArrowUp" || key === "ArrowLeft") return -1;
  return 0;
}
