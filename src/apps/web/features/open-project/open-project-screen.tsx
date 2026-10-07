import { IconSearch } from "@tabler/icons-react";
import {
  type JSX,
  type KeyboardEvent,
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
import {
  OpenProjectSectionHeading,
  openProjectItemId,
  ProjectList,
} from "#web/features/open-project/project-list.tsx";
import { useOpenProjectResults } from "#web/features/open-project/use-open-project-results.ts";
import type { ProjectNavigationRepository } from "#web/features/project-navigation/project-navigation.ts";
import { RepositoryFolderPicker } from "#web/features/repository-folder-picker/repository-folder-browser.tsx";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";

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
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [query, setQuery] = useState("");
  const [activeKey, setActiveKey] = useState<string>();
  const [expandedKey, setExpandedKey] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    environments,
    projects,
    hiddenProjectCount,
    groups,
    pastedUrl,
    keyboardItems,
    hasCloneSources,
  } = useOpenProjectResults(query, showAllProjects, collapsedGroupIds);

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

  const openRepository = (repository: OpenProjectRepository) =>
    onOpenRepository(repository);
  const openSettings = (repository: OpenProjectRepository) =>
    onOpenSettings(repository.id);
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
            className={`mt-4 text-body ${environmentStatus.availability === "unavailable" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {environmentStatus.detail}
          </p>
        )}
        {projects.length > 0 || pastedUrl !== undefined || hasCloneSources ? (
          <div
            aria-label="Repositories"
            className="mt-6 space-y-8"
            id="open-project-results"
            role="listbox"
          >
            {pastedUrl === undefined ? null : (
              <UrlGroup source={pastedUrl} {...cloneActions} />
            )}
            <ProjectList
              activeKey={activeKey}
              hiddenCount={hiddenProjectCount}
              items={projects}
              onActivate={setActiveKey}
              onOpen={openRepository}
              onOpenSettings={openSettings}
              onShowAll={() => {
                setShowAllProjects(true);
                inputRef.current?.focus();
              }}
            />
            {hasCloneSources ? (
              <section aria-labelledby="open-project-clone-heading">
                <OpenProjectSectionHeading id="open-project-clone-heading">
                  Clone
                </OpenProjectSectionHeading>
                <div className="space-y-[1.2rem]">
                  {groups.map((group) => (
                    <HostRepositoriesGroup
                      group={group}
                      key={group.id}
                      onOpenChange={(open) =>
                        setGroupCollapsed(group.id, !open)
                      }
                      open={!collapsedGroupIds.has(group.id)}
                      {...cloneActions}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : query.trim().length > 0 ? (
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

function EmptySearch() {
  return (
    <div className="flex min-h-42 flex-col items-center justify-center text-center">
      <IconSearch
        aria-hidden="true"
        className="mb-3 size-8 text-muted-foreground"
        stroke={1.25}
      />
      <strong className="text-body font-semibold">No repositories found</strong>
    </div>
  );
}

function keyboardDirection(key: string): -1 | 0 | 1 {
  if (key === "ArrowDown" || key === "ArrowRight") return 1;
  if (key === "ArrowUp" || key === "ArrowLeft") return -1;
  return 0;
}
