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
import type { JSX } from "react";
import type { EnvironmentSessionPresentation } from "#web/features/application-shell/environment-session-presentation";
import type { ProjectNavigationState } from "#web/features/project-navigation/project-navigation.contract";
import { environmentRepositories } from "#web/features/project-navigation/project-navigation-state";
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

export function ProjectsSidebar({
  collapse,
  environmentStatus,
  expand,
  navigation,
  toggleEnvironment,
}: {
  readonly collapse: () => void;
  readonly environmentStatus: EnvironmentSessionPresentation;
  readonly expand: () => void;
  readonly navigation: ProjectNavigationState;
  readonly toggleEnvironment: (environmentId: string) => void;
}): JSX.Element {
  return (
    <nav
      aria-label="Projects"
      className="flex h-full min-h-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
    >
      {navigation.sidebarCollapsed ? (
        <CollapsedProjectsSidebar
          environmentStatus={environmentStatus}
          expand={expand}
          navigation={navigation}
        />
      ) : (
        <ExpandedProjectsSidebar
          collapse={collapse}
          environmentStatus={environmentStatus}
          navigation={navigation}
          toggleEnvironment={toggleEnvironment}
        />
      )}
    </nav>
  );
}

function ExpandedProjectsSidebar({
  collapse,
  environmentStatus,
  navigation,
  toggleEnvironment,
}: {
  readonly collapse: () => void;
  readonly environmentStatus: EnvironmentSessionPresentation;
  readonly navigation: ProjectNavigationState;
  readonly toggleEnvironment: (environmentId: string) => void;
}) {
  return (
    <>
      <div className="flex h-11 shrink-0 items-center px-4 text-sidebar-accent-foreground">
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
          Projects
        </h1>
        <Button
          aria-label="Collapse Projects sidebar"
          onClick={collapse}
          size="icon"
          variant="ghost"
        >
          <IconLayoutSidebarLeftCollapse aria-hidden="true" />
        </Button>
      </div>
      <Button className="mx-3 mt-3 justify-center" variant="outline">
        <IconFolderPlus aria-hidden="true" data-icon="inline-start" />
        Open project
      </Button>
      <div className="relative mx-3 mt-2 mb-1.5">
        <IconSearch
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-label="Filter open projects"
          className="pl-9"
          placeholder="Filter open projects..."
        />
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
              <div
                className="flex h-9 min-w-0 items-center gap-1.5 px-1"
                title={environmentStatus.detail}
              >
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
                  className={`shrink-0 truncate text-sm ${environmentStatus.availability === "unavailable" ? "text-status-unavailable" : "text-muted-foreground"}`}
                  data-connection-state={environmentStatus.connectionState}
                  role="status"
                >
                  {environmentStatus.availability === "available"
                    ? environment.repositories.length
                    : environmentStatus.status}
                </span>
              </div>
              <CollapsibleContent>
                {environmentRepositories(environment).map((repository) => (
                  <button
                    className="grid h-11 w-full min-w-0 grid-cols-[1.875rem_minmax(0,1fr)_1.375rem] items-center gap-2.5 rounded-lg px-2.5 text-left text-base text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-45"
                    disabled={repository.disabled}
                    key={repository.id}
                    type="button"
                  >
                    <span className="grid size-7.5 shrink-0 place-items-center rounded-md bg-secondary text-sm font-semibold">
                      {repositoryInitials(repository.name)}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {repository.name}
                    </span>
                    <IconX
                      aria-hidden="true"
                      className="size-4 text-muted-foreground"
                    />
                  </button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
      </div>
      <SidebarSettings />
    </>
  );
}

function CollapsedProjectsSidebar({
  environmentStatus,
  expand,
  navigation,
}: {
  readonly environmentStatus: EnvironmentSessionPresentation;
  readonly expand: () => void;
  readonly navigation: ProjectNavigationState;
}) {
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          aria-label="Expand Projects sidebar"
          className="mx-auto mt-1 grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
          onClick={expand}
        >
          <IconLayoutSidebarLeftExpand aria-hidden="true" className="size-5" />
        </TooltipTrigger>
        <TooltipContent side="right">Expand Projects sidebar</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          aria-label="Open project"
          className="mx-auto mt-2 grid size-10 shrink-0 place-items-center rounded-md border border-sidebar-border text-sidebar-foreground outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
        >
          <IconFolderPlus aria-hidden="true" className="size-5" />
        </TooltipTrigger>
        <TooltipContent side="right">Open project</TooltipContent>
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
          const environmentLabel = `${environment.name}, ${environmentStatus.status}`;
          return (
            <div
              className="grid justify-items-center gap-1.5"
              key={environment.id}
            >
              <Tooltip>
                <TooltipTrigger
                  aria-label={environmentLabel}
                  className={`grid h-9 w-11 place-items-center rounded-md outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring/40 ${environmentStatus.availability === "unavailable" ? "text-status-unavailable" : "text-muted-foreground"}`}
                >
                  <IconDeviceLaptop aria-hidden="true" className="size-5" />
                </TooltipTrigger>
                <TooltipContent side="right">{environmentLabel}</TooltipContent>
              </Tooltip>
              {environmentRepositories(environment).map((repository) => (
                <span
                  className="grid size-11 place-items-center rounded-lg bg-secondary text-sm font-semibold text-sidebar-foreground data-[disabled=true]:opacity-45"
                  data-disabled={repository.disabled}
                  key={repository.id}
                  title={`${repository.name} · ${environment.name}`}
                >
                  {repositoryInitials(repository.name)}
                </span>
              ))}
            </div>
          );
        })}
      </div>
      <SidebarSettings collapsed />
    </>
  );
}

function SidebarSettings({
  collapsed = false,
}: {
  readonly collapsed?: boolean;
}) {
  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger
          aria-label="Settings"
          className="mx-auto mb-3 grid size-10 shrink-0 place-items-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
        >
          <IconSettings aria-hidden="true" className="size-5" />
        </TooltipTrigger>
        <TooltipContent side="right">Settings</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Button
      className="mx-3 mb-2 h-10 justify-between px-2 text-muted-foreground"
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
