import type { DesktopUpdates } from "@rebase/contracts";
import { IconDeviceLaptop } from "@tabler/icons-react";
import {
  type JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import { environmentSessionPresentation } from "#web/features/application-shell/environment-session-presentation";
import { useApplicationShortcuts } from "#web/features/application-shell/use-application-shortcuts";
import { useProjectRepositoryActions } from "#web/features/application-shell/use-project-repository-actions";
import { useRepositoryRefsActions } from "#web/features/application-shell/use-repository-refs-actions";
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
import { useRepositoryHistoryReader } from "#web/features/repository-history/hooks/use-repository-history-reader";
import { RepositorySettingsPage } from "#web/features/repository-settings/index";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web-ui/components/ui/resizable";
import { useKeyboardShortcuts } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";
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
  const shortcuts = useKeyboardShortcuts();
  const lastConnectedEnvironmentId = useRef<string | undefined>(undefined);
  if (sessionState._tag === "Connected") {
    lastConnectedEnvironmentId.current = sessionState.environmentId;
  }
  const sidebarRef = useRef<PanelImperativeHandle>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [repositorySettingsId, setRepositorySettingsId] = useState<string>();
  const closeRepositorySettings = useCallback(
    () => setRepositorySettingsId(undefined),
    [],
  );
  const openRepositorySettings = useCallback(
    (environmentId: string, repository: { readonly id: string }) => {
      if (environmentId === localEnvironmentId)
        setRepositorySettingsId(repository.id);
    },
    [],
  );
  useEffect(() => {
    if (
      repositorySettingsId !== undefined &&
      repositoryCatalog.status === "ready" &&
      !repositoryCatalog.repositories.some(
        ({ id }) => id === repositorySettingsId,
      )
    )
      closeRepositorySettings();
  }, [repositorySettingsId, repositoryCatalog, closeRepositorySettings]);
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
    setRepositorySettingsId(undefined);
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
    onRepositoryOpened: closeRepositorySettings,
  });
  const {
    activeWorktreePath,
    branchesFocusRequest,
    focusBranchesSidebar,
    refs: repositoryRefs,
    retryRefs,
    selectRef,
  } = useRepositoryRefsActions({
    repositories: repositoryCatalog.repositories,
    selectedRepositoryId: navigation.selectedRepositoryId,
    session,
  });
  const toggleSidebar = useCallback(() => {
    if (sidebarRef.current?.isCollapsed()) {
      expandSidebar();
    } else {
      collapseSidebar();
    }
  }, [collapseSidebar, expandSidebar]);
  const focusSidebarFilter = useCallback(() => {
    setSettingsOpen(false);
    expandSidebar();
    setSidebarFilterRequest((current) => current + 1);
  }, [expandSidebar]);
  const updateNavigation = useCallback(
    (update: (current: ProjectNavigationState) => ProjectNavigationState) => {
      setRepositorySettingsId(undefined);
      setNavigation((current) =>
        update(
          navigationWithAvailability(current, environmentStatus.availability),
        ),
      );
    },
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
  const selectedRepository = repositoryCatalog.repositories.find(
    (repository) => repository.id === navigation.selectedRepositoryId,
  );

  const settingsRepository = repositoryCatalog.repositories.find(
    ({ id }) => id === repositorySettingsId,
  );
  const historyEnvironmentId =
    sessionState._tag === "Connected"
      ? sessionState.environmentId
      : sessionState._tag === "Reconnecting"
        ? (sessionState.environmentId ?? lastConnectedEnvironmentId.current)
        : lastConnectedEnvironmentId.current;
  const repositorySettingsOpen = settingsRepository !== undefined;
  const canWrite =
    sessionState._tag === "Connected" &&
    sessionState.accessCapabilities.includes("repository.write");
  const settingsTarget =
    settingsRepository === undefined
      ? undefined
      : { ...settingsRepository, environmentId: localEnvironmentId };

  const graphRepository =
    navigation.workspaceView === "repository" ? selectedRepository : undefined;
  const graphReader = useRepositoryHistoryReader(
    session.repositoryHistory,
    historyEnvironmentId,
    graphRepository?.id,
    graphRepository?.logicalRepositoryId ?? graphRepository?.id,
  );
  const sameHistory =
    graphRepository !== undefined &&
    settingsRepository !== undefined &&
    (graphRepository.logicalRepositoryId ?? graphRepository.id) ===
      (settingsRepository.logicalRepositoryId ?? settingsRepository.id);
  const settingsReader = useRepositoryHistoryReader(
    session.repositoryHistory,
    historyEnvironmentId,
    sameHistory ? undefined : settingsRepository?.id,
    sameHistory
      ? undefined
      : (settingsRepository?.logicalRepositoryId ?? settingsRepository?.id),
  );

  const openSelectedRepositorySettings = useCallback(() => {
    if (navigation.selectedRepositoryId !== undefined)
      openRepositorySettings(localEnvironmentId, {
        id: navigation.selectedRepositoryId,
      });
  }, [navigation.selectedRepositoryId, openRepositorySettings]);

  useApplicationShortcuts({
    availability: environmentStatus.availability,
    closeSelectedRepository,
    folderPickerOpen,
    focusBranchesSidebar,
    focusSidebarFilter,
    hasSelectedRepository:
      navigation.workspaceView === "repository" &&
      navigation.selectedRepositoryId !== undefined,
    openFolderPicker: browseRepository,
    openSettings: setSettingsOpen,
    openRepositorySettings: openSelectedRepositorySettings,
    repositorySettingsOpen,
    selectNextRepository,
    selectPreviousRepository,
    selectRepositoryByPosition,
    selectableRepositoryCount,
    settingsOpen,
    showOpenProject: showOpenProjectScreen,
    toggleSidebar,
  });

  return (
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
                openRepositorySettings={openRepositorySettings}
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
              <div
                className={`h-full ${repositorySettingsOpen ? "hidden" : ""}`}
                inert={repositorySettingsOpen}
              >
                {navigation.workspaceView === "open-project" ? (
                  <OpenProjectScreen
                    active={!settingsOpen && !repositorySettingsOpen}
                    browseAvailable={
                      environmentStatus.availability === "available"
                    }
                    environments={openProjectEnvironments}
                    expandedEnvironmentIds={expandedEnvironmentIds}
                    key={openProjectRequest}
                    onBrowse={browseRepository}
                    onEnvironmentOpenChange={setEnvironmentExpanded}
                    onOpenRepository={selectOpenProjectRepository}
                    onOpenSettings={(repository) =>
                      openRepositorySettings(
                        repository.environmentId,
                        repository,
                      )
                    }
                  />
                ) : (
                  <RepositoryWorkspace
                    accessCapabilities={
                      sessionState._tag === "Connected"
                        ? sessionState.accessCapabilities
                        : []
                    }
                    connected={sessionState._tag === "Connected"}
                    commandsActive={
                      !settingsOpen &&
                      !repositorySettingsOpen &&
                      !folderPickerOpen
                    }
                    shortcuts={shortcuts}
                    activeWorktreePath={activeWorktreePath}
                    branchesFocusRequest={branchesFocusRequest}
                    environmentId={historyEnvironmentId}
                    historyReader={graphReader}
                    logicalRepositoryId={
                      selectedRepository?.logicalRepositoryId
                    }
                    refs={repositoryRefs}
                    repositoryId={navigation.selectedRepositoryId}
                    repositoryName={selectedRepository?.name ?? "Repository"}
                    retryRefs={retryRefs}
                    selectRef={selectRef}
                  />
                )}
              </div>
              {settingsTarget === undefined ||
              settingsRepository === undefined ? null : (
                <RepositorySettingsPage
                  key={JSON.stringify([
                    historyEnvironmentId,
                    settingsRepository.id,
                  ])}
                  repository={settingsTarget}
                  environmentId={historyEnvironmentId}
                  logicalRepositoryId={
                    settingsRepository.logicalRepositoryId ??
                    settingsRepository.id
                  }
                  environmentName={
                    visibleNavigation.environments.find(
                      ({ id }) => id === localEnvironmentId,
                    )?.name ?? "Environment"
                  }
                  reader={sameHistory ? graphReader : settingsReader}
                  connected={sessionState._tag === "Connected"}
                  canConfigure={canWrite}
                  canRemove={canWrite}
                  copyPath={() => copyRepositoryPath(settingsTarget)}
                  reveal={
                    window.rebaseHost?.revealRepository === undefined
                      ? undefined
                      : () => revealRepository(settingsTarget)
                  }
                  remove={async () => {
                    await removeRepository(settingsTarget);
                    closeRepositorySettings();
                  }}
                />
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
