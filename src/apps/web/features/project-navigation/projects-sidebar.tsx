import {
  IconChevronDown,
  IconDeviceLaptop,
  IconFolderPlus,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSearch,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { type JSX, type RefObject, useEffect, useRef, useState } from "react";
import type { EnvironmentSessionPresentation } from "#web/features/application-shell/environment-session-presentation";
import {
  keyboardShortcutAria,
  keyboardShortcutTitle,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type {
  ProjectNavigationRepository,
  ProjectNavigationState,
} from "#web/features/project-navigation/project-navigation.contract";
import { filterEnvironmentRepositories } from "#web/features/project-navigation/project-navigation-state";
import { RepositorySettingsButton } from "#web/features/repository-settings/index";
import { Button } from "#web-ui/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#web-ui/components/ui/collapsible";
import { Input } from "#web-ui/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "#web-ui/components/ui/tooltip";
import { useKeyboardShortcuts } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";

export function ProjectsSidebar({
  closeRepository,
  collapse,
  environmentStatus,
  expand,
  filterRequest,
  navigation,
  openProject,
  openSettings,
  openRepositorySettings,
  selectRepository,
  toggleEnvironment,
}: {
  readonly closeRepository: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
  readonly collapse: () => void;
  readonly environmentStatus: EnvironmentSessionPresentation;
  readonly expand: () => void;
  readonly filterRequest: number;
  readonly navigation: ProjectNavigationState;
  readonly openProject: () => void;
  readonly openSettings: () => void;
  readonly openRepositorySettings: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
  readonly selectRepository: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
  readonly toggleEnvironment: (environmentId: string) => void;
}): JSX.Element {
  const [filterQuery, setFilterQuery] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (filterRequest === 0) return;
    filterInputRef.current?.focus();
    filterInputRef.current?.select();
  }, [filterRequest]);

  return (
    <nav
      aria-label="Projects"
      className="flex h-full min-h-0 flex-col overflow-hidden border-sidebar-border/50 border-r bg-sidebar text-sidebar-foreground"
    >
      {navigation.sidebarCollapsed ? (
        <CollapsedProjectsSidebar
          environmentStatus={environmentStatus}
          expand={expand}
          filterQuery={filterQuery}
          navigation={navigation}
          openProject={openProject}
          openSettings={openSettings}
          selectRepository={selectRepository}
          toggleEnvironment={toggleEnvironment}
        />
      ) : (
        <ExpandedProjectsSidebar
          closeRepository={closeRepository}
          collapse={collapse}
          environmentStatus={environmentStatus}
          filterQuery={filterQuery}
          filterInputRef={filterInputRef}
          navigation={navigation}
          openProject={openProject}
          openSettings={openSettings}
          openRepositorySettings={openRepositorySettings}
          selectRepository={selectRepository}
          setFilterQuery={setFilterQuery}
          toggleEnvironment={toggleEnvironment}
        />
      )}
    </nav>
  );
}

function ExpandedProjectsSidebar({
  closeRepository,
  collapse,
  environmentStatus,
  filterQuery,
  filterInputRef,
  navigation,
  openProject,
  openSettings,
  openRepositorySettings,
  selectRepository,
  setFilterQuery,
  toggleEnvironment,
}: {
  readonly closeRepository: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
  readonly collapse: () => void;
  readonly environmentStatus: EnvironmentSessionPresentation;
  readonly filterQuery: string;
  readonly filterInputRef: RefObject<HTMLInputElement | null>;
  readonly navigation: ProjectNavigationState;
  readonly openProject: () => void;
  readonly openSettings: () => void;
  readonly openRepositorySettings: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
  readonly selectRepository: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
  readonly setFilterQuery: (query: string) => void;
  readonly toggleEnvironment: (environmentId: string) => void;
}) {
  const { bindings, platform } = useKeyboardShortcuts();
  const toggleSidebarShortcut = bindings["projects.toggleSidebar"];
  const focusFilterShortcut = bindings["projects.focusFilter"];
  const showOpenProjectShortcut = bindings["projects.showOpenProject"];
  const closeRepositoryShortcut = bindings["projects.closeActiveRepository"];

  return (
    <>
      <div className="flex h-11 shrink-0 items-center px-4 text-sidebar-accent-foreground">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
          Projects
        </h1>
        <Button
          aria-label="Collapse Projects sidebar"
          aria-keyshortcuts={keyboardShortcutAria(
            toggleSidebarShortcut,
            platform,
          )}
          onClick={collapse}
          size="icon"
          variant="ghost"
        >
          <IconLayoutSidebarLeftCollapse aria-hidden="true" />
        </Button>
      </div>
      <div className="mx-3 mt-3 mb-1.5 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <IconSearch
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Filter open projects"
            aria-keyshortcuts={keyboardShortcutAria(
              focusFilterShortcut,
              platform,
            )}
            className="pl-9"
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Filter open projects"
            ref={filterInputRef}
            value={filterQuery}
          />
        </div>
        <Button
          aria-current={
            navigation.workspaceView === "open-project" ? "page" : undefined
          }
          aria-label="Open project"
          aria-keyshortcuts={keyboardShortcutAria(
            showOpenProjectShortcut,
            platform,
          )}
          className={`!size-7.5 shrink-0 border-0 ${navigation.workspaceView === "open-project" ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
          onClick={openProject}
          size="icon"
          variant="ghost"
        >
          <IconFolderPlus aria-hidden="true" />
        </Button>
      </div>
      <div
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"
        data-slot="project-list-scroll"
      >
        <div aria-label="Open projects" className="px-2 py-1.5" role="tree">
          {navigation.environments.length === 0 ? (
            <span
              className="sr-only"
              data-connection-state={environmentStatus.connectionState}
              role="status"
            >
              {environmentStatus.status}
            </span>
          ) : null}
          {navigation.environments.map((environment) => (
            <Collapsible
              key={environment.id}
              onOpenChange={() => toggleEnvironment(environment.id)}
              open={environment.expanded}
            >
              <div className="flex h-9 min-w-0 items-center gap-1.5 px-1">
                <CollapsibleTrigger
                  aria-label={`${environment.expanded ? "Collapse" : "Expand"} ${environment.name}`}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
                >
                  <IconChevronDown
                    aria-hidden="true"
                    className={`size-4 transition-transform ${environment.expanded ? "" : "-rotate-90"}`}
                  />
                </CollapsibleTrigger>
                <IconDeviceLaptop
                  aria-hidden="true"
                  className="size-4.5 shrink-0 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate text-sm text-sidebar-foreground">
                  {environment.name}
                </span>
                <span
                  className={
                    environmentStatus.availability === "available"
                      ? "sr-only"
                      : `shrink-0 truncate text-sm ${environmentStatus.availability === "unavailable" ? "text-status-unavailable" : "text-muted-foreground"}`
                  }
                  data-connection-state={environmentStatus.connectionState}
                  role="status"
                >
                  {environmentStatus.status}
                </span>
              </div>
              <CollapsibleContent>
                {filterEnvironmentRepositories(environment, filterQuery).map(
                  (repository) => (
                    <div
                      className={`group grid h-11 w-full min-w-0 grid-cols-[minmax(0,1fr)_1.875rem_1.875rem] items-center rounded-lg pr-1.5 pl-2.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${navigation.selectedRepositoryId === repository.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
                      key={repository.id}
                    >
                      <button
                        aria-current={
                          navigation.workspaceView === "repository" &&
                          navigation.selectedRepositoryId === repository.id
                            ? "page"
                            : undefined
                        }
                        aria-label={`Open ${repository.name}`}
                        className="grid h-full min-w-0 grid-cols-[1.875rem_minmax(0,1fr)] items-center gap-2.5 text-left text-base outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 disabled:pointer-events-none disabled:opacity-45"
                        disabled={repository.disabled}
                        onClick={() =>
                          selectRepository(environment.id, repository)
                        }
                        type="button"
                      >
                        <span className="grid size-7.5 shrink-0 place-items-center rounded-md bg-secondary text-sm font-semibold">
                          {repositoryInitials(repository.name)}
                        </span>
                        <span className="min-w-0 truncate">
                          {repository.name}
                        </span>
                      </button>
                      <RepositorySettingsButton
                        name={repository.name}
                        active={
                          navigation.selectedRepositoryId === repository.id
                        }
                        onOpen={() =>
                          openRepositorySettings(environment.id, repository)
                        }
                      />
                      <button
                        aria-label={`Close ${repository.name}`}
                        aria-keyshortcuts={
                          navigation.workspaceView === "repository" &&
                          navigation.selectedRepositoryId === repository.id
                            ? keyboardShortcutAria(
                                closeRepositoryShortcut,
                                platform,
                              )
                            : undefined
                        }
                        className="grid size-7.5 place-items-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent-foreground/10 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
                        onClick={() =>
                          closeRepository(environment.id, repository)
                        }
                        type="button"
                      >
                        <IconX aria-hidden="true" className="size-4" />
                      </button>
                    </div>
                  ),
                )}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </div>
      <SidebarSettings openSettings={openSettings} />
    </>
  );
}

function CollapsedProjectsSidebar({
  environmentStatus,
  expand,
  filterQuery,
  navigation,
  openProject,
  openSettings,
  selectRepository,
  toggleEnvironment,
}: {
  readonly environmentStatus: EnvironmentSessionPresentation;
  readonly expand: () => void;
  readonly filterQuery: string;
  readonly navigation: ProjectNavigationState;
  readonly openProject: () => void;
  readonly openSettings: () => void;
  readonly selectRepository: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
  readonly toggleEnvironment: (environmentId: string) => void;
}) {
  const { bindings, platform } = useKeyboardShortcuts();
  const toggleSidebarShortcut = bindings["projects.toggleSidebar"];
  const showOpenProjectShortcut = bindings["projects.showOpenProject"];

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          aria-label="Expand Projects sidebar"
          aria-keyshortcuts={keyboardShortcutAria(
            toggleSidebarShortcut,
            platform,
          )}
          className="mx-auto mt-1 grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
          onClick={expand}
          title={keyboardShortcutTitle(
            "Expand Projects sidebar",
            toggleSidebarShortcut,
            platform,
          )}
        >
          <IconLayoutSidebarLeftExpand aria-hidden="true" className="size-5" />
        </TooltipTrigger>
        <TooltipContent side="right">
          {keyboardShortcutTitle(
            "Expand Projects sidebar",
            toggleSidebarShortcut,
            platform,
          )}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          aria-current={
            navigation.workspaceView === "open-project" ? "page" : undefined
          }
          aria-label="Open project"
          aria-keyshortcuts={keyboardShortcutAria(
            showOpenProjectShortcut,
            platform,
          )}
          className={`mx-auto mt-2 grid size-10 shrink-0 place-items-center rounded-md text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 ${navigation.workspaceView === "open-project" ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
          onClick={openProject}
          title={keyboardShortcutTitle(
            "Open project",
            showOpenProjectShortcut,
            platform,
          )}
        >
          <IconFolderPlus aria-hidden="true" className="size-5" />
        </TooltipTrigger>
        <TooltipContent side="right">
          {keyboardShortcutTitle(
            "Open project",
            showOpenProjectShortcut,
            platform,
          )}
        </TooltipContent>
      </Tooltip>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 pt-3">
        {navigation.environments.length === 0 ? (
          <span
            className="sr-only"
            data-connection-state={environmentStatus.connectionState}
            role="status"
          >
            {environmentStatus.status}
          </span>
        ) : null}
        {navigation.environments.map((environment) => {
          const environmentLabel = `${environment.expanded ? "Collapse" : "Expand"} ${environment.name}, ${environmentStatus.status}`;
          return (
            <div
              className="grid justify-items-center gap-1.5"
              key={environment.id}
            >
              <Tooltip>
                <TooltipTrigger
                  aria-expanded={environment.expanded}
                  aria-label={environmentLabel}
                  className={`grid size-10 place-items-center rounded-md outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 ${environmentStatus.availability === "unavailable" ? "text-status-unavailable" : "text-muted-foreground"}`}
                  onClick={() => toggleEnvironment(environment.id)}
                >
                  <IconDeviceLaptop aria-hidden="true" className="size-5" />
                </TooltipTrigger>
                <TooltipContent side="right">{environmentLabel}</TooltipContent>
              </Tooltip>
              {environment.expanded
                ? filterEnvironmentRepositories(environment, filterQuery).map(
                    (repository) => (
                      <button
                        aria-current={
                          navigation.workspaceView === "repository" &&
                          navigation.selectedRepositoryId === repository.id
                            ? "page"
                            : undefined
                        }
                        aria-label={repository.name}
                        className={`grid size-10 place-items-center rounded-md bg-secondary text-sm font-semibold text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 disabled:pointer-events-none disabled:opacity-45 ${navigation.selectedRepositoryId === repository.id ? "bg-sidebar-accent" : ""}`}
                        disabled={repository.disabled}
                        key={repository.id}
                        onClick={() =>
                          selectRepository(environment.id, repository)
                        }
                        title={`${repository.name} · ${environment.name}`}
                        type="button"
                      >
                        {repositoryInitials(repository.name)}
                      </button>
                    ),
                  )
                : null}
            </div>
          );
        })}
      </div>
      <SidebarSettings collapsed openSettings={openSettings} />
    </>
  );
}

function SidebarSettings({
  collapsed = false,
  openSettings,
}: {
  readonly collapsed?: boolean;
  readonly openSettings: () => void;
}) {
  const { bindings, platform } = useKeyboardShortcuts();
  const openSettingsShortcut = bindings["settings.open"];

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger
          aria-label="Settings"
          aria-keyshortcuts={keyboardShortcutAria(
            openSettingsShortcut,
            platform,
          )}
          className="mx-auto mb-3 grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
          onClick={openSettings}
          title={keyboardShortcutTitle(
            "Settings",
            openSettingsShortcut,
            platform,
          )}
        >
          <IconSettings aria-hidden="true" className="size-5" />
        </TooltipTrigger>
        <TooltipContent side="right">
          {keyboardShortcutTitle("Settings", openSettingsShortcut, platform)}
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button
      aria-keyshortcuts={keyboardShortcutAria(openSettingsShortcut, platform)}
      className="mx-3 mb-2 h-10 justify-between px-2 text-muted-foreground"
      onClick={openSettings}
      variant="ghost"
    >
      Settings
      <IconSettings aria-hidden="true" data-icon="inline-end" />
    </Button>
  );
}

function repositoryInitials(name: string): string {
  return name
    .split(/[-_\s]+/)
    .map((part) => part[0])
    .filter((character): character is string => character !== undefined)
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
