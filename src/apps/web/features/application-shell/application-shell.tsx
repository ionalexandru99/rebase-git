import type { DesktopUpdates } from "@rebase/contracts";
import { IconDeviceLaptop } from "@tabler/icons-react";
import {
  type JSX,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { environmentSessionPresentation } from "#web/features/application-shell/environment-session-presentation";
import { useApplicationShortcuts } from "#web/features/application-shell/use-application-shortcuts";
import { useProjectRepositoryActions } from "#web/features/application-shell/use-project-repository-actions";
import type { LocalEnvironmentSession } from "#web/features/local-environment-session/local-environment-session.contract";
import type { OpenProjectEnvironment } from "#web/features/open-project/open-project.contract";
import type { ProjectNavigationState } from "#web/features/project-navigation/project-navigation.contract";
import {
  selectProjectRepositoryByOffset,
  selectProjectRepositoryByPosition,
  setEnvironmentAvailability,
  setProjectSidebarCollapsed,
  showOpenProject,
  toggleEnvironment,
} from "#web/features/project-navigation/project-navigation-state";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web-ui/components/ui/resizable";
import { TooltipProvider } from "#web-ui/components/ui/tooltip";
import { OpenProjectScreen } from "#web-ui/features/open-project/open-project-screen";
import { ProjectsSidebar } from "#web-ui/features/project-navigation/projects-sidebar";
import { RepositoryFolderPicker } from "#web-ui/features/repository-folder-picker/repository-folder-picker";
import { RepositoryWorkspace } from "#web-ui/features/repository-workspace/repository-workspace";
import { SettingsPanel } from "#web-ui/features/settings/settings-panel";

const localEnvironmentId = "local-environment";
const projectSidebarSize = {
  collapsed: "3rem",
  default: "16rem",
  max: "25rem",
  min: "13rem",
} as const;

export function ApplicationShell({
  desktopUpdates,
  productVersion,
  session,
}: {
  readonly desktopUpdates: DesktopUpdates | undefined;
  readonly productVersion: string;
  readonly session: LocalEnvironmentSession;
}): JSX.Element {
  const sessionState = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
  );
  const repositoryCatalog = useSyncExternalStore(
    session.repositoryCatalog.subscribe,
    session.repositoryCatalog.getSnapshot,
  );
  const environmentStatus = environmentSessionPresentation(sessionState);
  const sidebarRef = useRef<PanelImperativeHandle>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openProjectRequest, setOpenProjectRequest] = useState(0);
  const [sidebarFilterRequest, setSidebarFilterRequest] = useState(0);
  const [navigation, setNavigation] = useState<ProjectNavigationState>(() => ({
    environments: [
      {
        availability: environmentStatus.availability,
        expanded: true,
        id: localEnvironmentId,
        name: "Local Environment",
        repositories: [],
      },
    ],
    selectedRepositoryId: undefined,
    sidebarCollapsed: false,
    workspaceView: "open-project",
  }));
  const currentNavigation = navigationWithAvailability(
    navigation,
    environmentStatus.availability,
  );
  const visibleNavigation =
    sessionState._tag === "PairingRequired"
      ? { ...currentNavigation, environments: [] }
      : currentNavigation;
  const openProjectEnvironments: readonly OpenProjectEnvironment[] =
    visibleNavigation.environments
      .filter((environment) => environment.id === localEnvironmentId)
      .map((environment) => ({
        availability: environment.availability,
        icon: IconDeviceLaptop,
        iconColor: "var(--primary)",
        id: environment.id,
        name: environment.name,
        repositories: repositoryCatalog.repositories.map((repository) => ({
          environmentId: environment.id,
          id: repository.id,
          lastOpenedAt: repository.lastOpenedAt,
          name: repository.name,
          path: repository.path,
        })),
        status: environmentStatus.status,
      }));

  const setCollapsed = useCallback((collapsed: boolean) => {
    setNavigation((current) =>
      current.sidebarCollapsed === collapsed
        ? current
        : setProjectSidebarCollapsed(current, collapsed),
    );
  }, []);
  const collapseSidebar = useCallback(() => {
    sidebarRef.current?.collapse();
    setCollapsed(true);
  }, [setCollapsed]);
  const expandSidebar = useCallback(() => {
    sidebarRef.current?.expand();
    setCollapsed(false);
  }, [setCollapsed]);
  const showOpenProjectScreen = useCallback(() => {
    setNavigation((current) => showOpenProject(current));
    setOpenProjectRequest((current) => current + 1);
  }, []);
  const {
    browseRepository,
    closeSelectedRepository,
    closeSidebarRepository,
    copyRepositoryPath,
    expandedEnvironmentIds,
    folderPickerOpen,
    listRepositoryDirectory,
    openRepositoryFromFolder,
    removeRepository,
    revealRepository,
    selectOpenProjectRepository,
    selectSidebarRepository,
    setEnvironmentExpanded,
    setFolderPickerOpen,
  } = useProjectRepositoryActions({
    availability: environmentStatus.availability,
    environmentId: localEnvironmentId,
    session,
    setNavigation,
  });
  const toggleSidebar = useCallback(() => {
    if (sidebarRef.current?.isCollapsed()) expandSidebar();
    else collapseSidebar();
  }, [collapseSidebar, expandSidebar]);
  const focusSidebarFilter = useCallback(() => {
    setSettingsOpen(false);
    expandSidebar();
    setSidebarFilterRequest((current) => current + 1);
  }, [expandSidebar]);
  const updateNavigation = useCallback(
    (update: (current: ProjectNavigationState) => ProjectNavigationState) =>
      setNavigation((current) =>
        update(
          navigationWithAvailability(current, environmentStatus.availability),
        ),
      ),
    [environmentStatus.availability],
  );
  const selectPreviousRepository = useCallback(
    () =>
      updateNavigation((current) =>
        selectProjectRepositoryByOffset(current, -1),
      ),
    [updateNavigation],
  );
  const selectNextRepository = useCallback(
    () =>
      updateNavigation((current) =>
        selectProjectRepositoryByOffset(current, 1),
      ),
    [updateNavigation],
  );
  const selectRepositoryByPosition = useCallback(
    (position: number) =>
      updateNavigation((current) =>
        selectProjectRepositoryByPosition(current, position),
      ),
    [updateNavigation],
  );
  const selectableRepositoryCount = visibleNavigation.environments.reduce(
    (count, environment) =>
      environment.availability === "available"
        ? count + environment.repositories.length
        : count,
    0,
  );

  useApplicationShortcuts({
    availability: environmentStatus.availability,
    closeSelectedRepository,
    folderPickerOpen,
    focusSidebarFilter,
    hasSelectedRepository:
      navigation.workspaceView === "repository" &&
      navigation.selectedRepositoryId !== undefined,
    openFolderPicker: browseRepository,
    openSettings: setSettingsOpen,
    selectNextRepository,
    selectPreviousRepository,
    selectRepositoryByPosition,
    selectableRepositoryCount,
    settingsOpen,
    showOpenProject: showOpenProjectScreen,
    toggleSidebar,
  });

  return (
    <TooltipProvider>
      <div className="h-svh min-h-80 w-full overflow-hidden bg-background">
        <section
          aria-label="Rebase application"
          className="h-full overflow-hidden bg-background"
        >
          <div className={`h-full ${settingsOpen ? "hidden" : ""}`}>
            <ResizablePanelGroup
              className="h-full min-h-0"
              orientation="horizontal"
            >
              <ResizablePanel
                collapsedSize={projectSidebarSize.collapsed}
                collapsible
                defaultSize={projectSidebarSize.default}
                groupResizeBehavior="preserve-pixel-size"
                id="projects"
                maxSize={projectSidebarSize.max}
                minSize={projectSidebarSize.min}
                onResize={() =>
                  setCollapsed(sidebarRef.current?.isCollapsed() ?? false)
                }
                panelRef={sidebarRef}
              >
                <ProjectsSidebar
                  closeRepository={closeSidebarRepository}
                  collapse={collapseSidebar}
                  environmentStatus={environmentStatus}
                  expand={expandSidebar}
                  filterRequest={sidebarFilterRequest}
                  navigation={visibleNavigation}
                  openProject={showOpenProjectScreen}
                  openSettings={() => setSettingsOpen(true)}
                  selectRepository={selectSidebarRepository}
                  toggleEnvironment={(environmentId) =>
                    setNavigation((current) =>
                      toggleEnvironment(current, environmentId),
                    )
                  }
                />
              </ResizablePanel>
              <ResizableHandle className="bg-transparent after:w-2 focus-visible:ring-primary/40" />
              <ResizablePanel
                className="rounded-none"
                id="repository"
                minSize="40%"
              >
                {navigation.workspaceView === "open-project" ? (
                  <OpenProjectScreen
                    active={!settingsOpen}
                    browseAvailable={
                      environmentStatus.availability === "available"
                    }
                    environments={openProjectEnvironments}
                    expandedEnvironmentIds={expandedEnvironmentIds}
                    key={openProjectRequest}
                    onBrowse={browseRepository}
                    onCopyPath={copyRepositoryPath}
                    onEnvironmentOpenChange={setEnvironmentExpanded}
                    onOpenRepository={selectOpenProjectRepository}
                    onRemoveRepository={removeRepository}
                    onRevealRepository={revealRepository}
                    revealAvailable={
                      window.rebaseHost?.revealRepository !== undefined
                    }
                  />
                ) : (
                  <RepositoryWorkspace />
                )}
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
          {settingsOpen ? (
            <SettingsPanel
              closeSettings={() => setSettingsOpen(false)}
              desktopUpdates={desktopUpdates}
              productVersion={productVersion}
            />
          ) : null}
          <RepositoryFolderPicker
            environments={openProjectEnvironments}
            listDirectory={listRepositoryDirectory}
            onOpenChange={setFolderPickerOpen}
            onOpenRepository={openRepositoryFromFolder}
            open={folderPickerOpen}
          />
        </section>
      </div>
    </TooltipProvider>
  );
}

function navigationWithAvailability(
  navigation: ProjectNavigationState,
  availability: ProjectNavigationState["environments"][number]["availability"],
): ProjectNavigationState {
  return setEnvironmentAvailability(
    navigation,
    localEnvironmentId,
    availability,
  );
}
