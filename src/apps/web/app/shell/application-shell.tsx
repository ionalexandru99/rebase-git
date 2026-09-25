import type {
  DesktopUpdates,
  EnvironmentAccessCapability,
  RepositoryFilesystemHost,
} from "@rebase/contracts";
import { IconDeviceLaptop } from "@tabler/icons-react";
import { type JSX, useCallback, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import type { LocalEnvironmentSession } from "#web/app/environment/local-environment-session.contract";
import { environmentSessionPresentation } from "#web/app/shell/environment-session-presentation";
import { useOpenedRepository } from "#web/app/shell/hooks/use-opened-repository";
import { useProjectRepositoryActions } from "#web/app/shell/hooks/use-project-repository-actions";
import { useRepositoryRefsActions } from "#web/app/shell/hooks/use-repository-refs-actions";
import {
  type OpenProjectEnvironment,
  OpenProjectScreen,
} from "#web/features/open-project/index";
import {
  type ProjectNavigationState,
  ProjectsSidebar,
  setEnvironmentAvailability,
  setProjectSidebarCollapsed,
  showOpenProject,
  toggleEnvironment,
} from "#web/features/project-navigation/index";
import { RepositoryFolderPicker } from "#web/features/repository-folder-picker/index";
import { useRepositoryHistoryReader } from "#web/features/repository-history/hooks/use-repository-history-reader";
import { RepositorySettingsPage } from "#web/features/repository-settings/index";
import { SettingsPanel } from "#web/features/settings/index";
import { useStore } from "#web/platform/store/use-store";
import { RepositoryActions } from "#web-ui/app/shell/repository-actions";
import { RepositoryWorkspace } from "#web-ui/app/workspace/repository-workspace";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web-ui/components/ui/resizable";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";

const localEnvironmentId = "local-environment";
const noAccessCapabilities: readonly EnvironmentAccessCapability[] = [];
const projectSidebarSize = {
  collapsed: "3rem",
  default: "16rem",
  max: "25rem",
  min: "13rem",
} as const;

export function ApplicationShell({
  desktopUpdates,
  productVersion,
  repositoryFilesystem,
  session,
}: {
  readonly desktopUpdates: DesktopUpdates | undefined;
  readonly productVersion: string;
  readonly repositoryFilesystem: RepositoryFilesystemHost | undefined;
  readonly session: LocalEnvironmentSession;
}): JSX.Element {
  const sessionState = useStore(session);
  const repositoryCatalog = useStore(session.repositoryCatalog);
  const environmentStatus = environmentSessionPresentation(sessionState);
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
  const [openProjectRequest, setOpenProjectRequest] = useState(0);
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
    activeWorktreePath,
    refs: repositoryRefs,
    retryRefs,
    selectRef,
    worktreePathFor,
  } = useRepositoryRefsActions({
    repositories: repositoryCatalog.repositories,
    selectedRepositoryId: navigation.selectedRepositoryId,
    session,
  });
  const historyEnvironmentId =
    sessionState._tag === "Connected"
      ? sessionState.environmentId
      : sessionState._tag === "Reconnecting"
        ? (sessionState.environmentId ?? lastConnectedEnvironmentId.current)
        : lastConnectedEnvironmentId.current;
  const selectedRepository = repositoryCatalog.repositories.find(
    (repository) => repository.id === navigation.selectedRepositoryId,
  );
  const graphRepository =
    navigation.workspaceView === "repository" ? selectedRepository : undefined;
  const { history: graphHistory, open: openRepositoryHistory } =
    useOpenedRepository({
      environmentId: historyEnvironmentId,
      repository: graphRepository,
      session,
      worktreePathFor,
    });
  const openRepositoryView = useCallback(
    (repositoryId: string) => {
      closeRepositorySettings();
      openRepositoryHistory(repositoryId);
    },
    [closeRepositorySettings, openRepositoryHistory],
  );
  const {
    browseRepository,
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
    repositoryFilesystem,
    session,
    setNavigation,
    onRepositoryOpened: openRepositoryView,
  });
  const settingsRepository = repositoryCatalog.repositories.find(
    ({ id }) => id === repositorySettingsId,
  );
  const repositorySettingsOpen = settingsRepository !== undefined;
  const canWrite =
    sessionState._tag === "Connected" &&
    sessionState.accessCapabilities.includes("repository.write");
  const settingsTarget =
    settingsRepository === undefined
      ? undefined
      : { ...settingsRepository, environmentId: localEnvironmentId };

  const graphReader = graphHistory?.reader;
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
  const connected = sessionState._tag === "Connected";
  const panelVisible = !settingsOpen && !repositorySettingsOpen;
  const panelEnvironment = useMemo(
    () => ({
      environmentId: historyEnvironmentId,
      requests: session.requests,
      changes: session.changes,
      runtime: session.runtime,
      connected,
      writable: canWrite,
      visible: panelVisible,
    }),
    [
      historyEnvironmentId,
      session.requests,
      session.changes,
      session.runtime,
      connected,
      canWrite,
      panelVisible,
    ],
  );
  const graphRepositoryId = graphRepository?.id;
  const repositoryTarget = useMemo(
    () =>
      graphRepositoryId === undefined || session.requests === undefined
        ? undefined
        : {
            repositoryId: graphRepositoryId,
            worktreePath: activeWorktreePath,
            requests: session.requests,
            changes: session.changes,
            runtime: session.runtime,
          },
    [
      graphRepositoryId,
      activeWorktreePath,
      session.requests,
      session.changes,
      session.runtime,
    ],
  );
  const repositoryScope = useMemo(
    () =>
      repositoryTarget === undefined
        ? undefined
        : { target: repositoryTarget, connected, writable: canWrite },
    [repositoryTarget, connected, canWrite],
  );
  const panelRepositoryIds = useMemo(
    () =>
      navigation.environments.flatMap((environment) =>
        environment.repositories.map((repository) => repository.id),
      ),
    [navigation.environments],
  );

  const content = (
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
                        : noAccessCapabilities
                    }
                    connected={sessionState._tag === "Connected"}
                    activeWorktreePath={activeWorktreePath}
                    environmentId={historyEnvironmentId}
                    history={graphHistory}
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
                    revealRepository === undefined
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
  return (
    <RepositoryActions scope={repositoryScope} refs={session.repositoryRefs}>
      <WorkspacePanel.Sessions
        environment={panelEnvironment}
        repositoryIds={panelRepositoryIds}
      >
        {content}
      </WorkspacePanel.Sessions>
    </RepositoryActions>
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
