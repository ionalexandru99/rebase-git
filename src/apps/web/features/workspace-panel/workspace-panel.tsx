import {
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
} from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "#web-ui/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web-ui/components/ui/resizable";
import { WorkspacePanelTabs } from "#web-ui/features/workspace-panel/components/workspace-panel-tabs";
import {
  useWorkspacePanel,
  WorkspacePanelProvider,
} from "#web-ui/features/workspace-panel/workspace-panel-provider";

function Group({ children }: { readonly children: ReactNode }) {
  const { store, panelId } = useWorkspacePanel();
  return (
    <ResizablePanelGroup
      className="h-full min-h-0"
      orientation="horizontal"
      onLayoutChanged={(layout) => {
        const width = layout[panelId];
        if (width !== undefined) store.dispatch({ type: "resize", width });
      }}
    >
      {children}
    </ResizablePanelGroup>
  );
}

function Toggle() {
  const panel = useWorkspacePanel();
  return (
    <Button
      aria-label={panel.state.open ? "Hide side panel" : "Show side panel"}
      aria-expanded={panel.state.open}
      variant="ghost"
      size="icon-sm"
      className="border-0 bg-transparent shadow-none aria-expanded:bg-transparent"
      onClick={() =>
        panel.execute({ type: "visibility", open: !panel.state.open })
      }
    >
      {panel.state.open ? (
        <IconLayoutSidebarRightCollapse aria-hidden="true" />
      ) : (
        <IconLayoutSidebarRightExpand aria-hidden="true" />
      )}
    </Button>
  );
}

function Pane() {
  const { state, panelId } = useWorkspacePanel();
  if (!state.open) return null;
  return (
    <>
      <ResizableHandle
        aria-label="Resize side panel"
        className="z-10 bg-transparent after:w-2 focus-visible:ring-primary/40"
      />
      <ResizablePanel
        id={panelId}
        defaultSize={`${state.width}%`}
        minSize="18rem"
        maxSize="65%"
      >
        <aside
          aria-label="Side panel"
          className="h-full min-h-0 border-border border-l"
        >
          <WorkspacePanelTabs />
        </aside>
      </ResizablePanel>
    </>
  );
}

export const WorkspacePanel = {
  Provider: WorkspacePanelProvider,
  Group,
  Toggle,
  Pane,
};
