import { type ReactNode, useRef } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web/components/ui/resizable";

const projectSidebarSize = {
  collapsed: "3rem",
  default: "16rem",
  max: "25rem",
  min: "13rem",
} as const;

export interface SidebarPanel {
  readonly collapse: () => void;
  readonly expand: () => void;
}

export function ApplicationLayout({
  sidebar,
  onSidebarCollapsedChange,
  repositorySettings,
  settings,
  children,
}: {
  readonly sidebar: (panel: SidebarPanel) => ReactNode;
  readonly onSidebarCollapsedChange: (collapsed: boolean) => void;
  readonly repositorySettings: ReactNode;
  readonly settings: ReactNode;
  readonly children: ReactNode;
}) {
  const sidebarRef = useRef<PanelImperativeHandle>(null);
  const panel: SidebarPanel = {
    collapse: () => {
      sidebarRef.current?.collapse();
      onSidebarCollapsedChange(true);
    },
    expand: () => {
      sidebarRef.current?.expand();
      onSidebarCollapsedChange(false);
    },
  };
  const settingsOpen = settings !== undefined;
  const repositorySettingsOpen = repositorySettings !== undefined;
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
                onSidebarCollapsedChange(
                  sidebarRef.current?.isCollapsed() ?? false,
                )
              }
              panelRef={sidebarRef}
            >
              {sidebar(panel)}
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
                {children}
              </div>
              {repositorySettings}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        {settings}
      </section>
    </div>
  );
}
