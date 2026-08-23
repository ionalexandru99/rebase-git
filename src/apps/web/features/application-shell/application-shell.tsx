import type { DesktopUpdates } from "@rebase/contracts";
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
import type { ProjectNavigationState } from "#web/features/project-navigation/project-navigation.contract";
import {
  setEnvironmentAvailability,
  setProjectSidebarCollapsed,
  toggleEnvironment,
} from "#web/features/project-navigation/project-navigation-state";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web-ui/components/ui/resizable";
import { TooltipProvider } from "#web-ui/components/ui/tooltip";
import { ProjectsSidebar } from "#web-ui/features/project-navigation/projects-sidebar";
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
  const environmentStatus = environmentSessionPresentation(sessionState);
  const sidebarRef = useRef<PanelImperativeHandle>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  }));
  const currentNavigation = navigationWithAvailability(
    navigation,
    environmentStatus.availability,
  );
  const visibleNavigation =
    sessionState._tag === "PairingRequired"
      ? { ...currentNavigation, environments: [] }
      : currentNavigation;

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

  useEffect(() => {
    const handleApplicationShortcut = (event: KeyboardEvent) => {
      if (event.key === "Escape" && settingsOpen) {
        event.preventDefault();
        setSettingsOpen(false);
        return;
      }

      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) {
        return;
      }

      if (event.key === ",") {
        event.preventDefault();
        setSettingsOpen(true);
        return;
      }

      if (event.key.toLowerCase() !== "b" || settingsOpen) return;

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
  }, [collapseSidebar, expandSidebar, settingsOpen]);

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
                  collapse={collapseSidebar}
                  environmentStatus={environmentStatus}
                  expand={expandSidebar}
                  navigation={visibleNavigation}
                  openSettings={() => setSettingsOpen(true)}
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
                <RepositoryWorkspace />
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
