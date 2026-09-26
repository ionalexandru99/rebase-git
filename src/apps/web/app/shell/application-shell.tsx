import type {
  DesktopUpdates,
  RepositoryFilesystemHost,
} from "@rebase/contracts";
import { IconDeviceLaptop } from "@tabler/icons-react";
import { type JSX, useCallback, useMemo, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import type {
  LocalEnvironmentSession,
  LocalEnvironmentSessionState,
} from "#web/app/environment/local-environment-session.contract";
import { environmentSessionPresentation } from "#web/app/shell/environment-session-presentation";
import { useActiveWorktree } from "#web/app/shell/hooks/use-active-worktree";
import { useOpenedRepository } from "#web/app/shell/hooks/use-opened-repository";
import { useProjectRepositoryActions } from "#web/app/shell/hooks/use-project-repository-actions";
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
import { RepositoryScopeProvider } from "#web/features/repository-scope/index";
import { RepositorySettingsPage } from "#web/features/repository-settings/index";
import { SettingsPanel } from "#web/features/settings/index";
import { useStore } from "#web/platform/store/use-store";
import { RepositoryWorkspace } from "#web-ui/app/workspace/repository-workspace";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web-ui/components/ui/resizable";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";
import {
  EnvironmentProvider,
  useEnvironment,
} from "#web-ui/platform/query/environment-context";

const localEnvironmentId = "local-environment";
const projectSidebarSize = {
  collapsed: "3rem",
  default: "16rem",
  max: "25rem",
  min: "13rem",
} as const;

interface ApplicationShellProps {
  readonly desktopUpdates: DesktopUpdates | undefined;
  readonly productVersion: string;
  readonly repositoryFilesystem: RepositoryFilesystemHost | undefined;
  readonly session: LocalEnvironmentSession;
}

export function ApplicationShell(props: ApplicationShellProps): JSX.Element {
  const { session } = props;
  const sessionState = useStore(session);
  const lastConnectedEnvironmentId = useRef<string | undefined>(undefined);
  if (sessionState._tag === "Connected") {
    lastConnectedEnvironmentId.current = sessionState.environmentId;
  }
  const environmentId =
    sessionState._tag === "Connected"
      ? sessionState.environmentId
      : sessionState._tag === "Reconnecting"
        ? (sessionState.environmentId ?? lastConnectedEnvironmentId.current)
        : lastConnectedEnvironmentId.current;
  const connected = sessionState._tag === "Connected";
  const rpc = connected ? sessionState.rpc : undefined;
  const readable =
    connected && sessionState.accessCapabilities.includes("repository.read");
  const writable =
    connected && sessionState.accessCapabilities.includes("repository.write");
  const environment = useMemo(
    () => ({
      environmentId,
      requests: session.requests,
      rpc,
      changes: session.changes,
      connected,
      readable,
      writable,
    }),
    [
      environmentId,
      session.requests,
      rpc,
      session.changes,
      connected,
      readable,
      writable,
    ],
  );
  return (
    <EnvironmentProvider environment={environment}>
      <ApplicationShellContent {...props} sessionState={sessionState} />
    </EnvironmentProvider>
  );
}

function ApplicationShellContent({
  desktopUpdates,
  productVersion,
  repositoryFilesystem,
  session,
  sessionState,
}: ApplicationShellProps & {
  readonly sessionState: LocalEnvironmentSessionState;
}): JSX.Element {
  const {
    environmentId: historyEnvironmentId,
    connected,
    readable: canRead,
    writable: canWrite,
  } = useEnvironment();
  const repositoryCatalog = useStore(session.repositoryCatalog);
  const environmentStatus = environmentSessionPresentation(sessionState);
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
  const selectedRepository = repositoryCatalog.repositories.find(
    (repository) => repository.id === navigation.selectedRepositoryId,
  );
  const selectedLogicalRepositoryId =
    selectedRepository?.logicalRepositoryId ?? selectedRepository?.id;
  const { activeWorktreePath, refs, switchWorktree, worktreePathFor } =
    useActiveWorktree(selectedRepository, selectedLogicalRepositoryId);
  const graphRepository =
    navigation.workspaceView === "repository" ? selectedRepository : undefined;
  const { history: graphHistory, open: openRepositoryHistory } =
    useOpenedRepository({
      environmentId: historyEnvironmentId,
      refs,
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
  const graphLogicalRepositoryId =
    graphRepository === undefined ? undefined : selectedLogicalRepositoryId;
  const repositoryScope = useMemo(
    () =>
      graphRepositoryId === undefined || graphLogicalRepositoryId === undefined
        ? undefined
        : {
            repositoryId: graphRepositoryId,
            worktreePath: activeWorktreePath,
            logicalRepositoryId: graphLogicalRepositoryId,
            connected,
            readable: canRead,
            writable: canWrite,
          },
    [
      graphRepositoryId,
      graphLogicalRepositoryId,
      activeWorktreePath,
      connected,
      canRead,
      canWrite,
    ],
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
                    activeWorktreePath={activeWorktreePath}
                    environmentId={historyEnvironmentId}
                    history={graphHistory}
                    logicalRepositoryId={selectedLogicalRepositoryId}
                    repositoryId={navigation.selectedRepositoryId}
                    repositoryName={selectedRepository?.name ?? "Repository"}
                    switchWorktree={switchWorktree}
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
                  connected={connected}
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
    <RepositoryScopeProvider scope={repositoryScope}>
      <WorkspacePanel.Sessions
        environment={panelEnvironment}
        repositoryIds={panelRepositoryIds}
      >
        {content}
      </WorkspacePanel.Sessions>
    </RepositoryScopeProvider>
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
