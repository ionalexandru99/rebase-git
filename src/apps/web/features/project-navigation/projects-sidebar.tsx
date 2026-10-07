import {
  IconFolderPlus,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconSearch,
  IconSettings,
  IconX,
} from "@tabler/icons-react";
import { type JSX, useState } from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import type {
  ProjectNavigationRepository,
  ProjectNavigationRepositoryItem,
  ProjectNavigationState,
} from "#web/features/project-navigation/project-navigation.ts";
import { filterEnvironmentRepositories } from "#web/features/project-navigation/project-navigation-state.ts";
import { RepositoryBadge } from "#web/features/repository-catalog/repository-badge.tsx";
import { RepositorySettingsButton } from "#web/features/repository-settings/components/repository-settings-button.tsx";
import {
  type EnvironmentStatus,
  useEnvironment,
} from "#web/platform/query/environment-context.tsx";

export function ProjectsSidebar({
  closeRepository,
  collapse,
  expand,
  navigation,
  openProject,
  openSettings,
  openRepositorySettings,
  selectRepository,
}: {
  readonly closeRepository: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
  readonly collapse: () => void;
  readonly expand: () => void;
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
}): JSX.Element {
  const [filterQuery, setFilterQuery] = useState("");
  const { status: environmentStatus } = useEnvironment();
  const projects = navigation.environments.flatMap((environment) =>
    filterEnvironmentRepositories(environment, filterQuery).map(
      (repository) => ({ environmentId: environment.id, repository }),
    ),
  );

  return (
    <nav
      aria-label="Projects"
      className="flex h-full min-h-0 flex-col overflow-hidden border-sidebar-border/50 border-r bg-sidebar text-sidebar-foreground"
    >
      {navigation.sidebarCollapsed ? (
        <CollapsedProjectsSidebar
          environmentStatus={environmentStatus}
          expand={expand}
          navigation={navigation}
          openProject={openProject}
          openSettings={openSettings}
          projects={projects}
          selectRepository={selectRepository}
        />
      ) : (
        <ExpandedProjectsSidebar
          closeRepository={closeRepository}
          collapse={collapse}
          environmentStatus={environmentStatus}
          filterQuery={filterQuery}
          navigation={navigation}
          openProject={openProject}
          openSettings={openSettings}
          openRepositorySettings={openRepositorySettings}
          projects={projects}
          selectRepository={selectRepository}
          setFilterQuery={setFilterQuery}
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
  navigation,
  openProject,
  openSettings,
  openRepositorySettings,
  projects,
  selectRepository,
  setFilterQuery,
}: {
  readonly closeRepository: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
  readonly collapse: () => void;
  readonly environmentStatus: EnvironmentStatus;
  readonly filterQuery: string;
  readonly navigation: ProjectNavigationState;
  readonly openProject: () => void;
  readonly openSettings: () => void;
  readonly openRepositorySettings: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
  readonly projects: readonly SidebarProject[];
  readonly selectRepository: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
  readonly setFilterQuery: (query: string) => void;
}) {
  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 px-3">
        <h1 className="sr-only">Projects</h1>
        <div className="relative min-w-0 flex-1">
          <IconSearch
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label="Filter projects"
            className="pl-9"
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder="Filter projects"
            value={filterQuery}
          />
        </div>
        <Button
          aria-current={
            navigation.workspaceView === "open-project" ? "page" : undefined
          }
          aria-label="Open project"
          className={`!size-7.5 shrink-0 border-0 ${navigation.workspaceView === "open-project" ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
          onClick={openProject}
          size="icon"
          variant="ghost"
        >
          <IconFolderPlus aria-hidden="true" />
        </Button>
        <Button
          aria-label="Collapse Projects sidebar"
          className="shrink-0"
          onClick={collapse}
          size="icon"
          variant="ghost"
        >
          <IconLayoutSidebarLeftCollapse aria-hidden="true" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <div aria-label="Open projects" className="px-2 py-1.5" role="tree">
          <span
            className={
              environmentStatus.availability === "available"
                ? "sr-only"
                : `block truncate px-2.5 py-2 text-body ${environmentStatus.availability === "unavailable" ? "text-status-unavailable" : "text-muted-foreground"}`
            }
            role="status"
          >
            {environmentStatus.status}
          </span>
          {projects.map(({ environmentId, repository }) => (
            <div
              className={`group grid h-11 w-full min-w-0 grid-cols-[minmax(0,1fr)_1.875rem_1.875rem] items-center rounded-control pr-1.5 pl-2.5 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground ${navigation.selectedRepositoryId === repository.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
              key={repository.id}
            >
              <button
                aria-current={
                  isCurrentProject(navigation, repository.id)
                    ? "page"
                    : undefined
                }
                aria-label={`Open ${repository.name}`}
                className="grid h-full min-w-0 grid-cols-[1.875rem_minmax(0,1fr)] items-center gap-2.5 text-left text-body outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 disabled:pointer-events-none disabled:opacity-40"
                disabled={repository.disabled}
                onClick={() => selectRepository(environmentId, repository)}
                type="button"
              >
                <RepositoryBadge
                  className="size-7.5 rounded-control text-meta"
                  color={repository.color}
                  name={repository.name}
                />
                <span className="min-w-0 truncate">{repository.name}</span>
              </button>
              <RepositorySettingsButton
                name={repository.name}
                onOpen={() => openRepositorySettings(environmentId, repository)}
              />
              <button
                aria-label={`Close ${repository.name}`}
                className="grid size-7.5 place-items-center rounded-control text-muted-foreground outline-none hover:bg-sidebar-accent-foreground/10 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
                onClick={() => closeRepository(environmentId, repository)}
                type="button"
              >
                <IconX aria-hidden="true" className="size-4" />
              </button>
            </div>
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
  navigation,
  openProject,
  openSettings,
  projects,
  selectRepository,
}: {
  readonly environmentStatus: EnvironmentStatus;
  readonly expand: () => void;
  readonly navigation: ProjectNavigationState;
  readonly openProject: () => void;
  readonly openSettings: () => void;
  readonly projects: readonly SidebarProject[];
  readonly selectRepository: (
    environmentId: string,
    repository: ProjectNavigationRepository,
  ) => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Expand Projects sidebar"
        className={`mx-auto mt-1 grid size-10 shrink-0 place-items-center rounded-control outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 ${environmentStatus.availability === "unavailable" ? "text-status-unavailable" : "text-muted-foreground"}`}
        onClick={expand}
      >
        <IconLayoutSidebarLeftExpand aria-hidden="true" className="size-5" />
      </button>

      <button
        type="button"
        aria-current={
          navigation.workspaceView === "open-project" ? "page" : undefined
        }
        aria-label="Open project"
        className={`mx-auto mt-2 grid size-10 shrink-0 place-items-center rounded-control text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 ${navigation.workspaceView === "open-project" ? "bg-sidebar-accent text-sidebar-accent-foreground" : ""}`}
        onClick={openProject}
      >
        <IconFolderPlus aria-hidden="true" className="size-5" />
      </button>

      <div className="flex min-h-0 flex-1 flex-col items-center gap-1.5 pt-3">
        <span className="sr-only" role="status">
          {environmentStatus.status}
        </span>
        {projects.map(({ environmentId, repository }) => (
          <button
            aria-current={
              isCurrentProject(navigation, repository.id) ? "page" : undefined
            }
            aria-label={repository.name}
            className={`rounded-control outline-none hover:brightness-125 focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 disabled:pointer-events-none disabled:opacity-40 ${navigation.selectedRepositoryId === repository.id ? "ring-[1.5px] ring-sidebar-accent-foreground ring-offset-2 ring-offset-sidebar" : ""}`}
            disabled={repository.disabled}
            key={repository.id}
            onClick={() => selectRepository(environmentId, repository)}
            type="button"
          >
            <RepositoryBadge
              className="size-10 rounded-control text-control"
              color={repository.color}
              name={repository.name}
            />
          </button>
        ))}
      </div>
      <SidebarSettings collapsed openSettings={openSettings} />
    </>
  );
}

interface SidebarProject {
  readonly environmentId: string;
  readonly repository: ProjectNavigationRepositoryItem;
}

function isCurrentProject(
  navigation: ProjectNavigationState,
  repositoryId: string,
) {
  return (
    navigation.workspaceView === "repository" &&
    navigation.selectedRepositoryId === repositoryId
  );
}

function SidebarSettings({
  collapsed = false,
  openSettings,
}: {
  readonly collapsed?: boolean;
  readonly openSettings: () => void;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        aria-label="Settings"
        className="mx-auto mb-3 grid size-10 shrink-0 place-items-center rounded-control text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
        onClick={openSettings}
      >
        <IconSettings aria-hidden="true" className="size-5" />
      </button>
    );
  }
  return (
    <button
      type="button"
      className="mx-2 mb-2 grid h-11 shrink-0 grid-cols-[1.875rem_minmax(0,1fr)] items-center gap-2.5 rounded-control pl-2.5 text-left text-body text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
      onClick={openSettings}
    >
      <IconSettings
        aria-hidden="true"
        className="size-4.5 justify-self-center"
      />
      Settings
    </button>
  );
}
