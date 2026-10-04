import { type JSX, type ReactNode, useCallback, useMemo, useRef } from "react";
import type { RepositoryFilesystemHost } from "#contracts/desktop-host/desktop-host.contract.ts";
import type { DesktopUpdates } from "#contracts/desktop-updates/desktop-updates.contract.ts";
import { RepositoryCatalogApi } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import type {
  LocalEnvironmentSession,
  LocalEnvironmentSessionState,
} from "#web/app/environment/local-environment-session.ts";
import { ApplicationLayout } from "#web/app/shell/application-layout.tsx";
import { environmentSessionPresentation } from "#web/app/shell/environment-session-presentation.ts";
import { RepositorySelectionProvider } from "#web/app/shell/repository-selection-provider.tsx";
import {
  type Navigate,
  type Navigation,
  useNavigation,
  visibleProjects,
} from "#web/app/shell/use-navigation.ts";
import { RepositoryWorkspace } from "#web/app/workspace/repository-workspace.tsx";
import { NotificationsProvider } from "#web/features/notifications/notifications.tsx";
import { OpenProjectScreen } from "#web/features/open-project/open-project-screen.tsx";
import type { ProjectNavigationRepository } from "#web/features/project-navigation/project-navigation.ts";
import { ProjectsSidebar } from "#web/features/project-navigation/projects-sidebar.tsx";
import {
  catalogWith,
  useCatalogRepository,
} from "#web/features/repository-catalog/use-repository-catalog.ts";
import { useRepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { RepositorySettingsPage } from "#web/features/repository-settings/repository-settings-page.tsx";
import { SettingsPanel } from "#web/features/settings/settings-panel.tsx";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import {
  unavailableRequests,
  unavailableSubscriptions,
} from "#web/platform/environment/environment-connection.ts";
import {
  EnvironmentProvider,
  useEnvironment,
} from "#web/platform/query/environment-context.tsx";
import { useCommand } from "#web/platform/query/use-command.ts";
import { useStore } from "#web/platform/store/use-store.ts";

interface ApplicationShellProps {
  readonly desktopUpdates: DesktopUpdates | undefined;
  readonly productVersion: string;
  readonly repositoryFilesystem: RepositoryFilesystemHost | undefined;
}

export function ApplicationShell({
  session,
  ...props
}: ApplicationShellProps & {
  readonly session: LocalEnvironmentSession;
}): JSX.Element {
  return (
    <SessionEnvironmentProvider session={session}>
      <Shell {...props} />
    </SessionEnvironmentProvider>
  );
}

function Shell({
  desktopUpdates,
  productVersion,
  repositoryFilesystem,
}: ApplicationShellProps): JSX.Element {
  const { navigation, navigate } = useNavigation();
  const { openRepository, showRepository } = useRepositoryOpening(navigate);
  const projects = visibleProjects(
    navigation.projects,
    useEnvironment().status,
  );
  const repositorySettingsId = useCatalogRepository(
    navigation.repositorySettingsId,
  )?.id;
  const repositories = useMemo(
    () =>
      navigation.projects.environments.flatMap(
        ({ repositories }) => repositories,
      ),
    [navigation.projects.environments],
  );
  const openGitIdentity = useCallback(
    () => navigate({ type: "show-settings", section: "source-control" }),
    [navigate],
  );
  const openNotifiedRepository = useCallback(
    (repositoryId: string) => {
      const repository = repositories.find(({ id }) => id === repositoryId);
      if (repository !== undefined) openRepository(repository);
    },
    [repositories, openRepository],
  );
  return (
    <NotificationsProvider
      currentRepositoryId={
        navigation.projects.workspaceView === "repository"
          ? navigation.projects.selectedRepositoryId
          : undefined
      }
      openGitIdentity={openGitIdentity}
      openRepository={openNotifiedRepository}
      repositories={repositories}
    >
      <RepositorySelectionProvider navigation={navigation} navigate={navigate}>
        <PanelSessions
          navigation={navigation}
          visible={
            navigation.settingsSection === undefined &&
            repositorySettingsId === undefined
          }
        >
          <ApplicationLayout
            onSidebarCollapsedChange={(collapsed) =>
              navigate({ type: "collapse-sidebar", collapsed })
            }
            sidebar={(panel) => (
              <ProjectsSidebar
                closeRepository={(_, { id }) =>
                  navigate({ type: "close-repository", repositoryId: id })
                }
                collapse={panel.collapse}
                expand={panel.expand}
                navigation={projects}
                openProject={() => navigate({ type: "show-open-project" })}
                openSettings={() =>
                  navigate({ type: "show-settings", section: "general" })
                }
                openRepositorySettings={(_, { id }) =>
                  navigate({
                    type: "show-repository-settings",
                    repositoryId: id,
                  })
                }
                selectRepository={(_, repository) => openRepository(repository)}
                toggleEnvironment={(environmentId) =>
                  navigate({ type: "toggle-environment", environmentId })
                }
              />
            )}
            repositorySettings={
              repositorySettingsId === undefined ? undefined : (
                <RepositorySettingsView
                  repositoryId={repositorySettingsId}
                  reveal={
                    repositoryFilesystem === undefined
                      ? undefined
                      : (path) => repositoryFilesystem.revealRepository(path)
                  }
                  onRemoved={() =>
                    navigate({
                      type: "close-repository",
                      repositoryId: repositorySettingsId,
                    })
                  }
                />
              )
            }
            settings={
              navigation.settingsSection === undefined ? undefined : (
                <SettingsPanel
                  closeSettings={() =>
                    navigate({ type: "show-settings", section: undefined })
                  }
                  section={navigation.settingsSection}
                  selectSection={(section) =>
                    navigate({ type: "show-settings", section })
                  }
                  desktopUpdates={desktopUpdates}
                  productVersion={productVersion}
                />
              )
            }
          >
            {projects.workspaceView === "open-project" ? (
              <OpenProjectScreen
                key={navigation.openProjectRequest}
                onOpenRepository={openRepository}
                onRepositoryRemembered={showRepository}
                onOpenSettings={(repositoryId) =>
                  navigate({ type: "show-repository-settings", repositoryId })
                }
              />
            ) : (
              <RepositoryWorkspace />
            )}
          </ApplicationLayout>
        </PanelSessions>
      </RepositorySelectionProvider>
    </NotificationsProvider>
  );
}

function useRepositoryOpening(navigate: Navigate) {
  const { status } = useEnvironment();
  const { run: recordOpened } = useCommand(RepositoryCatalogApi.recordOpened, {
    answers: catalogWith,
  });
  const available = status.availability === "available";
  const showRepository = useCallback(
    (repository: ProjectNavigationRepository) =>
      navigate({ type: "open-repository", repository }),
    [navigate],
  );
  const openRepository = useCallback(
    (repository: ProjectNavigationRepository) => {
      if (!available) return;
      showRepository(repository);
      void recordOpened({ repositoryId: repository.id });
    },
    [available, recordOpened, showRepository],
  );
  return { openRepository, showRepository };
}

function RepositorySettingsView({
  repositoryId,
  reveal,
  onRemoved,
}: {
  readonly repositoryId: string;
  readonly reveal: ((path: string) => Promise<void>) | undefined;
  readonly onRemoved: () => void;
}) {
  const { environmentId } = useEnvironment();
  const repository = useCatalogRepository(repositoryId);
  const history = useRepositoryHistory(
    environmentId === undefined || repository === undefined
      ? undefined
      : {
          environmentId,
          repositoryId: repository.id,
          logicalRepositoryId: repository.logicalRepositoryId ?? repository.id,
        },
  );
  return (
    <RepositorySettingsPage
      key={JSON.stringify([environmentId, repositoryId])}
      repositoryId={repositoryId}
      history={history}
      reveal={reveal}
      onRemoved={onRemoved}
    />
  );
}

function PanelSessions({
  navigation,
  visible,
  children,
}: {
  readonly navigation: Navigation;
  readonly visible: boolean;
  readonly children: ReactNode;
}) {
  const { environmentId, connected, writable } = useEnvironment();
  const environment = useMemo(
    () => ({ environmentId, connected, writable, visible }),
    [environmentId, connected, writable, visible],
  );
  const { environments } = navigation.projects;
  const repositoryIds = useMemo(
    () =>
      environments.flatMap(({ repositories }) =>
        repositories.map(({ id }) => id),
      ),
    [environments],
  );
  return (
    <WorkspacePanel.Sessions
      environment={environment}
      repositoryIds={repositoryIds}
    >
      {children}
    </WorkspacePanel.Sessions>
  );
}

function SessionEnvironmentProvider({
  session,
  children,
}: {
  readonly session: LocalEnvironmentSession;
  readonly children: ReactNode;
}) {
  const state = useStore(session);
  const environmentId = useRetainedEnvironmentId(state);
  const connected = state._tag === "Connected";
  const requests = connected ? state.requests : unavailableRequests;
  const subscribe = connected ? state.subscribe : unavailableSubscriptions;
  const readable = connected;
  const writable = connected;
  const status = useMemo(() => environmentSessionPresentation(state), [state]);
  const environment = useMemo(
    () => ({
      environmentId,
      requests,
      subscribe,
      connected,
      readable,
      writable,
      status,
    }),
    [environmentId, requests, subscribe, connected, readable, writable, status],
  );
  return (
    <EnvironmentProvider environment={environment}>
      {children}
    </EnvironmentProvider>
  );
}

function useRetainedEnvironmentId(state: LocalEnvironmentSessionState) {
  const lastConnected = useRef<string | undefined>(undefined);
  if (state._tag === "Connected") lastConnected.current = state.environmentId;
  return state._tag === "Reconnecting"
    ? (state.environmentId ?? lastConnected.current)
    : lastConnected.current;
}
