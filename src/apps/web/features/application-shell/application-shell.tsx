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
import type { LocalEnvironmentSession } from "#web/features/local-environment-session/local-environment-session.contract";
import type {
  OpenProjectEnvironment,
  OpenProjectRepository,
} from "#web/features/open-project/open-project.contract";
import type { ProjectNavigationState } from "#web/features/project-navigation/project-navigation.contract";
import {
  openProjectRepository,
  removeProjectRepository,
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
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [openProjectRequest, setOpenProjectRequest] = useState(0);
  const [sidebarFilterRequest, setSidebarFilterRequest] = useState(0);
  const [expandedOpenProjectEnvironments, setExpandedOpenProjectEnvironments] =
    useState<ReadonlySet<string>>(() => new Set([localEnvironmentId]));
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
    visibleNavigation.environments.map((environment) => ({
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
  const selectOpenProjectRepository = useCallback(
    (repository: OpenProjectRepository) => {
      if (environmentStatus.availability !== "available") return;

      void session.repositoryCatalog
        .recordOpened(repository.id)
        .catch(() => undefined);
      setNavigation((current) =>
        openProjectRepository(
          navigationWithAvailability(current, environmentStatus.availability),
          repository.environmentId,
          {
            id: repository.id,
            name: repository.name,
          },
        ),
      );
    },
    [environmentStatus.availability, session.repositoryCatalog],
  );
  const browseRepository = useCallback(() => {
    if (environmentStatus.availability !== "available") return;
    setFolderPickerOpen(true);
  }, [environmentStatus.availability]);
  const listRepositoryDirectory = useCallback(
    (environmentId: string, path?: string) => {
      if (environmentId !== localEnvironmentId) {
        return Promise.reject(new Error("The Environment is unavailable."));
      }
      return session.filesystem.listDirectory(path);
    },
    [session.filesystem],
  );
  const openRepositoryFromFolder = useCallback(
    async (environmentId: string, path: string) => {
      if (
        environmentId !== localEnvironmentId ||
        environmentStatus.availability !== "available"
      ) {
        throw new Error("The Environment is unavailable.");
      }
      const remembered = await session.repositoryCatalog.remember(path);
      setNavigation((current) =>
        openProjectRepository(
          navigationWithAvailability(current, environmentStatus.availability),
          environmentId,
          {
            id: remembered.id,
            name: remembered.name,
          },
        ),
      );
    },
    [environmentStatus.availability, session.repositoryCatalog],
  );
  const copyRepositoryPath = useCallback(
    (repository: OpenProjectRepository) => {
      void navigator.clipboard
        .writeText(repository.path)
        .catch(() => undefined);
    },
    [],
  );
  const revealRepository = useCallback((repository: OpenProjectRepository) => {
    void window.rebaseHost
      ?.revealRepository(repository.path)
      .catch(() => undefined);
  }, []);
  const selectSidebarRepository = useCallback(
    (
      environmentId: string,
      repository: ProjectNavigationState["environments"][number]["repositories"][number],
    ) => {
      if (environmentStatus.availability !== "available") return;

      void session.repositoryCatalog
        .recordOpened(repository.id)
        .catch(() => undefined);
      setNavigation((current) =>
        openProjectRepository(
          navigationWithAvailability(current, environmentStatus.availability),
          environmentId,
          repository,
        ),
      );
    },
    [environmentStatus.availability, session.repositoryCatalog],
  );
  const closeSidebarRepository = useCallback(
    (environmentId: string, repository: { readonly id: string }) => {
      setNavigation((current) =>
        removeProjectRepository(current, environmentId, repository.id),
      );
    },
    [],
  );
  const closeSelectedRepository = useCallback(() => {
    setNavigation((current) => {
      if (current.selectedRepositoryId === undefined) return current;
      const environment = current.environments.find((candidate) =>
        candidate.repositories.some(
          (repository) => repository.id === current.selectedRepositoryId,
        ),
      );
      return environment === undefined
        ? current
        : removeProjectRepository(
            current,
            environment.id,
            current.selectedRepositoryId,
          );
    });
  }, []);
  const removeRepository = useCallback(
    (repository: OpenProjectRepository) => {
      void session.repositoryCatalog
        .remove(repository.id)
        .then(() =>
          setNavigation((current) =>
            removeProjectRepository(
              current,
              repository.environmentId,
              repository.id,
            ),
          ),
        )
        .catch(() => undefined);
    },
    [session.repositoryCatalog],
  );
  const setOpenProjectEnvironmentExpanded = useCallback(
    (environmentId: string, open: boolean) => {
      setExpandedOpenProjectEnvironments((current) => {
        const next = new Set(current);
        if (open) next.add(environmentId);
        else next.delete(environmentId);
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const handleApplicationShortcut = (event: KeyboardEvent) => {
      if (folderPickerOpen) return;

      if (event.key === "Escape" && settingsOpen) {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }

      const key = event.key.toLocaleLowerCase();
      if (key === "," && !event.shiftKey) {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }

      if (key === "o") {
        event.preventDefault();
        setSettingsOpen(false);
        if (event.shiftKey) {
          showOpenProjectScreen();
        } else if (environmentStatus.availability === "available") {
          setFolderPickerOpen(true);
        } else {
          showOpenProjectScreen();
        }
        return;
      }

      if (key === "w" && !event.shiftKey) {
        if (
          navigation.workspaceView === "repository" &&
          navigation.selectedRepositoryId !== undefined
        ) {
          event.preventDefault();
          closeSelectedRepository();
        }
        return;
      }

      if (key === "f" && event.shiftKey) {
        event.preventDefault();
        setSettingsOpen(false);
        expandSidebar();
        setSidebarFilterRequest((current) => current + 1);
        return;
      }

      if (key !== "b" || event.shiftKey || settingsOpen) return;

      event.preventDefault();
      if (sidebarRef.current?.isCollapsed()) {
        expandSidebar();
      } else {
        collapseSidebar();
      }
    };

    window.addEventListener("keydown", handleApplicationShortcut);
    return () =>
      window.removeEventListener("keydown", handleApplicationShortcut);
  }, [
    closeSelectedRepository,
    collapseSidebar,
    environmentStatus.availability,
    expandSidebar,
    folderPickerOpen,
    navigation.selectedRepositoryId,
    navigation.workspaceView,
    settingsOpen,
    showOpenProjectScreen,
  ]);

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
                    browseAvailable={
                      environmentStatus.availability === "available"
                    }
                    environments={openProjectEnvironments}
                    expandedEnvironmentIds={expandedOpenProjectEnvironments}
                    key={openProjectRequest}
                    onBrowse={browseRepository}
                    onCopyPath={copyRepositoryPath}
                    onEnvironmentOpenChange={setOpenProjectEnvironmentExpanded}
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
