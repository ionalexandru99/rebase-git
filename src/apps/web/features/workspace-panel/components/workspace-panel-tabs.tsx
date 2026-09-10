import { useLayoutEffect, useRef } from "react";
import { isWorkspacePanelKind } from "#web/features/workspace-panel/workspace-panel-state";
import { Tabs, TabsContent, TabsList } from "#web-ui/components/ui/tabs";
import { WorkspacePanelEmptyState } from "#web-ui/features/workspace-panel/components/workspace-panel-empty-state";
import { workspacePanelFeatures } from "#web-ui/features/workspace-panel/components/workspace-panel-kinds";
import { WorkspacePanelLauncher } from "#web-ui/features/workspace-panel/components/workspace-panel-launcher";
import { WorkspacePanelTab } from "#web-ui/features/workspace-panel/components/workspace-panel-tab";
import { useWorkspacePanel } from "#web-ui/features/workspace-panel/workspace-panel-provider";

export function WorkspacePanelTabs() {
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
      </div>
      {tabs.map((kind) => {
        const feature = workspacePanelFeatures[kind];
        return (
          <TabsContent key={kind} value={kind} className="overflow-auto">
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-3 p-6 text-center">
              <feature.icon
                aria-hidden="true"
                className="size-7 text-muted-foreground/60"
              />
              <h2 className="text-sm font-medium">{feature.label}</h2>
              <p className="text-xs text-muted-foreground">Coming soon</p>
            </div>
          </TabsContent>
        );
      })}
      {active === null ? <WorkspacePanelEmptyState /> : null}
    </Tabs>
  );
}
