import {
  IconArrowsDiagonal,
  IconArrowsDiagonalMinimize2,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useRef } from "react";
import { useGroupRef } from "react-resizable-panels";
import { Button } from "#web/components/ui/button.tsx";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web/components/ui/resizable.tsx";
import { WorkspacePanelTabs } from "#web/features/workspace-panel/components/workspace-panel-tabs.tsx";
import type { WorkspacePanelKind } from "#web/features/workspace-panel/workspace-panel-definitions.ts";
import {
  useWorkspacePanel,
  WorkspacePanelProvider,
} from "#web/features/workspace-panel/workspace-panel-provider.tsx";
import { WorkspacePanelSessions } from "#web/features/workspace-panel/workspace-panel-sessions.tsx";

function Group({ children }: { readonly children: ReactNode }) {
  const { store, panelId, state } = useWorkspacePanel();
  const groupRef = useGroupRef();
  const previous = useRef(false);
  const transitioning = useRef(false);
  const expanded = state.open && state.expanded === true;
  useEffect(() => {
    if (previous.current === expanded) return;
    previous.current = expanded;
    transitioning.current = true;
    const group = groupRef.current;
    if (!group) return;
    const layout = group.getLayout();
    const branches = layout.branches ?? 20;
    let settledFrame = 0;
    const frame = requestAnimationFrame(() => {
      group.setLayout({
        branches,
        workspace: expanded
          ? 0
          : 100 - branches - (state.open ? state.width : 0),
        ...(state.open
          ? { [panelId]: expanded ? 100 - branches : state.width }
          : {}),
      });
      settledFrame = requestAnimationFrame(() => {
        transitioning.current = false;
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settledFrame);
      transitioning.current = false;
    };
  }, [expanded, groupRef, panelId, state.open, state.width]);
  return (
    <ResizablePanelGroup
      className="h-full min-h-0"
      groupRef={groupRef}
      orientation="horizontal"
      onLayoutChanged={(layout) => {
        const width = layout[panelId];
        if (
          !expanded &&
          previous.current === expanded &&
          !transitioning.current &&
          width !== undefined
        )
          store.dispatch({ type: "resize", width });
      }}
    >
      {children}
    </ResizablePanelGroup>
  );
}

function Controls() {
  const panel = useWorkspacePanel();
  const { open, expanded } = panel.state;
  return (
    <div className="fixed top-0 right-0 z-30 flex h-12 items-center gap-0.5 pr-2">
      {open ? (
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={expanded ? "Restore side panel" : "Expand side panel"}
          aria-pressed={expanded === true}
          onClick={() => panel.execute({ type: "expand", expanded: !expanded })}
        >
          {expanded ? (
            <IconArrowsDiagonalMinimize2 aria-hidden="true" />
          ) : (
            <IconArrowsDiagonal aria-hidden="true" />
          )}
        </Button>
      ) : null}
      <Button
        aria-label={open ? "Hide side panel" : "Show side panel"}
        aria-expanded={open}
        variant="ghost"
        size="icon-sm"
        className="border-0 bg-transparent shadow-none aria-expanded:bg-transparent"
        onClick={() => panel.execute({ type: "visibility", open: !open })}
      >
        {open ? (
          <IconLayoutSidebarRightCollapse aria-hidden="true" />
        ) : (
          <IconLayoutSidebarRightExpand aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

function Main({
  children,
}: {
  readonly children: (visible: boolean) => ReactNode;
}) {
  const { state } = useWorkspacePanel();
  const visible = !(state.open && state.expanded);
  return (
    <ResizablePanel id="workspace" minSize="30%" collapsible collapsedSize={0}>
      <div
        className="h-full min-w-0 overflow-hidden"
        inert={!visible}
        aria-hidden={!visible}
      >
        {children(visible)}
      </div>
    </ResizablePanel>
  );
}

function Pane({
  contents,
}: {
  readonly contents?: Partial<Record<WorkspacePanelKind, ReactNode>>;
}) {
  const { state, panelId } = useWorkspacePanel();
  if (!state.open) return null;
  return (
    <>
      {!state.expanded ? (
        <ResizableHandle
          aria-label="Resize side panel"
          className="z-10 bg-transparent after:w-2 focus-visible:ring-primary/40"
        />
      ) : null}
      <ResizablePanel
        id={panelId}
        defaultSize={`${state.width}%`}
        minSize="18rem"
        maxSize={state.expanded ? "100%" : "65%"}
      >
        <aside
          aria-label="Side panel"
          className="h-full min-h-0 border-border border-l"
        >
          <WorkspacePanelTabs contents={contents} />
        </aside>
      </ResizablePanel>
    </>
  );
}

export const WorkspacePanel = {
  Sessions: WorkspacePanelSessions,
  Provider: WorkspacePanelProvider,
  Group,
  Controls,
  Pane,
  Main,
};
