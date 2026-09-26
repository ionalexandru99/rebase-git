import type {
  DesktopUpdates,
  RepositoryFilesystemHost,
} from "@rebase/contracts";
import type { JSX } from "react";
import type { LocalEnvironmentSession } from "#web/app/environment/local-environment-session.contract";
import { ApplicationLayout } from "#web/app/shell/application-layout";
import { PanelSessions } from "#web/app/shell/panel-sessions";
import { RepositorySelectionProvider } from "#web/app/shell/repository-selection-provider";
import { RepositorySettingsView } from "#web/app/shell/repository-settings-view";
import { SessionEnvironmentProvider } from "#web/app/shell/session-environment-provider";
import { useNavigation, visibleProjects } from "#web/app/shell/use-navigation";
import { useRepositoryOpening } from "#web/app/shell/use-repository-opening";
import { RepositoryWorkspace } from "#web/app/workspace/repository-workspace";
import { OpenProjectScreen } from "#web/features/open-project/open-project-screen";
import { ProjectsSidebar } from "#web/features/project-navigation/projects-sidebar";
import { useCatalogRepository } from "#web/features/repository-catalog/hooks/use-repository-catalog";
import type { RepositoryHistoryGateway } from "#web/features/repository-history/repository-history-reader";
import { SettingsPanel } from "#web/features/settings/settings-panel";
import { useEnvironment } from "#web/platform/query/environment-context";

interface ApplicationShellProps {
  readonly desktopUpdates: DesktopUpdates | undefined;
  readonly productVersion: string;
  readonly repositoryFilesystem: RepositoryFilesystemHost | undefined;
  readonly repositoryHistory: RepositoryHistoryGateway;
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
  repositoryHistory,
}: ApplicationShellProps): JSX.Element {
  const { navigation, navigate } = useNavigation();
  const { opened, openRepository, showRepository } = useRepositoryOpening(
    repositoryHistory,
    navigation.worktreePaths,
    navigate,
  );
  const projects = visibleProjects(
    navigation.projects,
    useEnvironment().status,
  );
  const repositorySettingsId = useCatalogRepository(
    navigation.repositorySettingsId,
  )?.id;
  return (
    <RepositorySelectionProvider
      navigation={navigation}
      navigate={navigate}
      opened={opened}
    >
      <PanelSessions
        navigation={navigation}
        visible={!navigation.settingsOpen && repositorySettingsId === undefined}
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
                navigate({ type: "show-settings", open: true })
              }
              openRepositorySettings={(_, { id }) =>
                navigate({ type: "show-repository-settings", repositoryId: id })
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
                gateway={repositoryHistory}
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
            navigation.settingsOpen ? (
              <SettingsPanel
                closeSettings={() =>
                  navigate({ type: "show-settings", open: false })
                }
                desktopUpdates={desktopUpdates}
                productVersion={productVersion}
              />
            ) : undefined
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
  );
}
