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
import {
  fitWorkspace,
  workspaceWidths,
} from "#web/features/workspace-panel/workspace-panel-state.ts";

function Group({ children }: { readonly children: ReactNode }) {
  const { store, panelId, state } = useWorkspacePanel();
  const groupRef = useGroupRef();
  const elementRef = useRef<HTMLDivElement>(null);
  const expanded = state.open && state.expanded === true;
  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const width = panelsWidth(element);
        if (width === 0) return;
        const fit = fitWorkspace({
          width,
          rem: rootFontSize(),
          widths: state.widths,
          open: state.open,
        });
        const sidebar = (fit.sidebar / width) * 100;
        const panel = (fit.panel / width) * 100;
        groupRef.current?.setLayout(
          !state.open
            ? { branches: sidebar, workspace: 100 - sidebar }
            : {
                branches: sidebar,
                workspace: expanded ? 0 : 100 - sidebar - panel,
                [panelId]: expanded ? 100 - sidebar : panel,
              },
        );
      });
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [expanded, groupRef, panelId, state.open, state.widths]);
  return (
    <ResizablePanelGroup
      className="h-full min-h-0"
      elementRef={elementRef}
      groupRef={groupRef}
      orientation="horizontal"
      onLayoutChanged={(layout, { isUserInteraction }) => {
        const element = elementRef.current;
        if (!isUserInteraction || expanded || !element) return;
        const width = panelsWidth(element);
        const rem = rootFontSize();
        const fit = fitWorkspace({
          width,
          rem,
          widths: state.widths,
          open: state.open,
        });
        const dragged = (id: string, fitted: number, saved: number) => {
          const size = layout[id];
          if (size === undefined) return saved;
          const pixels = (size / 100) * width;
          return Math.abs(pixels - fitted) < 1 ? saved : pixels / rem;
        };
        store.dispatch({
          type: "resize",
          widths: {
            sidebar: dragged("branches", fit.sidebar, state.widths.sidebar),
            panel: dragged(panelId, fit.panel, state.widths.panel),
          },
        });
      }}
    >
      {children}
    </ResizablePanelGroup>
  );
}

function panelsWidth(group: HTMLElement) {
  let width = 0;
  for (const child of group.children)
    if (child instanceof HTMLElement && child.hasAttribute("data-panel"))
      width += child.offsetWidth;
  return width;
}

function rootFontSize() {
  return (
    Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
  );
}

function Sidebar({ children }: { readonly children?: ReactNode }) {
  const { sidebar } = workspaceWidths;
  return (
    <>
      <ResizablePanel
        defaultSize={`${sidebar.initial}rem`}
        groupResizeBehavior="preserve-pixel-size"
        id="branches"
        maxSize={`${sidebar.max}rem`}
        minSize={`${sidebar.min}rem`}
      >
        {children}
      </ResizablePanel>
      <ResizableHandle
        aria-label="Resize branches sidebar"
        className="z-10 bg-transparent after:w-2 focus-visible:ring-primary/40"
      />
    </>
  );
}

function Controls({ children }: { readonly children?: ReactNode }) {
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
      {children}
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
    <ResizablePanel
      id="workspace"
      minSize={`${workspaceWidths.graph.min}rem`}
      collapsible
      collapsedSize={0}
    >
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
        defaultSize={`${workspaceWidths.panel.initial}rem`}
        groupResizeBehavior="preserve-pixel-size"
        minSize={`${workspaceWidths.panel.min}rem`}
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
  Sidebar,
  Controls,
  Pane,
  Main,
};
