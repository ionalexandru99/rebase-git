import { IconArrowsMaximize, IconArrowsMinimize } from "@tabler/icons-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Button } from "#web/components/ui/button";
import { Tabs, TabsContent, TabsList } from "#web/components/ui/tabs";
import { WorkspacePanelEmptyState } from "#web/features/workspace-panel/components/workspace-panel-empty-state";
import { WorkspacePanelLauncher } from "#web/features/workspace-panel/components/workspace-panel-launcher";
import { WorkspacePanelTab } from "#web/features/workspace-panel/components/workspace-panel-tab";
import type { WorkspacePanelKind } from "#web/features/workspace-panel/workspace-panel.contract";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider";
import { PanelSessionTarget } from "#web/features/workspace-panel/workspace-panel-sessions";
import { isWorkspacePanelKind } from "#web/features/workspace-panel/workspace-panel-state";

export function WorkspacePanelTabs({
  contents,
}: {
  readonly contents?:
    | Partial<Record<WorkspacePanelKind, ReactNode>>
    | undefined;
}) {
  const panel = useWorkspacePanel();
  const listRef = useRef<HTMLDivElement>(null);
  const handledFocusRequest = useRef(0);
  const { active, tabs } = panel.state;
  useLayoutEffect(() => {
    if (
      panel.focusRequest === handledFocusRequest.current ||
      panel.launcherOpen
    )
      return;
    handledFocusRequest.current = panel.focusRequest;
    const tab = listRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    (tab ?? panel.emptyStateRef.current)?.focus();
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [panel.focusRequest, panel.launcherOpen, panel.emptyStateRef]);

  return (
    <Tabs
      data-workspace-panel-tabs
      value={active}
      onValueChange={(kind) => {
        if (isWorkspacePanelKind(kind)) panel.execute({ type: "open", kind });
      }}
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <div className="flex h-11 shrink-0 items-center gap-1 border-border border-b px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1">
          {tabs.length > 0 ? (
            <>
              <TabsList
                ref={listRef}
                aria-label="Side panel tabs"
                activateOnFocus
                className="shrink-0 gap-1"
              >
                {tabs.map((kind) => (
                  <WorkspacePanelTab key={kind} kind={kind} />
                ))}
              </TabsList>
              <WorkspacePanelLauncher />
            </>
          ) : null}
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={
            panel.state.expanded ? "Restore side panel" : "Expand side panel"
          }
          aria-pressed={panel.state.expanded === true}
          onClick={() =>
            panel.execute({ type: "expand", expanded: !panel.state.expanded })
          }
        >
          {panel.state.expanded ? (
            <IconArrowsMinimize />
          ) : (
            <IconArrowsMaximize />
          )}
        </Button>
      </div>
      {tabs.map((kind) => {
        return (
          <TabsContent
            key={kind}
            value={kind}
            keepMounted
            className="min-h-0 flex-1 overflow-hidden data-[hidden]:hidden"
          >
            <PanelSessionTarget session={panel.session} kind={kind}>
              {contents?.[kind]}
            </PanelSessionTarget>
          </TabsContent>
        );
      })}
      {active === null ? <WorkspacePanelEmptyState /> : null}
    </Tabs>
  );
}
