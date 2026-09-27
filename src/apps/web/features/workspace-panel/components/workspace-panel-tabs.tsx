import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconX,
} from "@tabler/icons-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "#web/components/ui/tabs.tsx";
import { WorkspacePanelLauncher } from "#web/features/workspace-panel/components/workspace-panel-launcher.tsx";
import {
  type WorkspacePanelKind,
  workspacePanelDefinitions,
  workspacePanelKinds,
} from "#web/features/workspace-panel/workspace-panel-definitions.ts";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider.tsx";
import { PanelSessionTarget } from "#web/features/workspace-panel/workspace-panel-sessions.tsx";
import { isWorkspacePanelKind } from "#web/features/workspace-panel/workspace-panel-state.ts";
import { cn } from "#web/lib/utils.ts";

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

function WorkspacePanelTab({ kind }: { readonly kind: WorkspacePanelKind }) {
  const panel = useWorkspacePanel();
  const feature = workspacePanelDefinitions[kind];
  const active = panel.state.active === kind;
  return (
    <div
      className={cn(
        "group/tab flex h-6 max-w-36 shrink-0 items-center gap-1 rounded-md pl-1.5 text-xs",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Button
        aria-label={`Close ${feature.label} tab`}
        size="icon-xs"
        variant="ghost"
        className="size-4 text-inherit hover:bg-muted sm:size-4"
        onClick={() => panel.execute({ type: "close", kind })}
      >
        <feature.icon
          aria-hidden="true"
          className="size-3 group-hover/tab:hidden group-focus-within/tab:hidden"
        />
        <IconX
          aria-hidden="true"
          className="hidden size-3 group-hover/tab:block group-focus-within/tab:block"
        />
      </Button>
      <TabsTrigger
        value={kind}
        className="h-full min-w-0 rounded-sm pr-2 text-inherit"
        onKeyDown={(event) => {
          if (event.key === "Delete") {
            event.preventDefault();
            panel.execute({ type: "close", kind });
          }
        }}
      >
        <span className="truncate">{feature.label}</span>
      </TabsTrigger>
    </div>
  );
}

function WorkspacePanelEmptyState() {
  const panel = useWorkspacePanel();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8">
      <div className="my-auto w-full max-w-100 self-center">
        <h2
          ref={panel.emptyStateRef}
          tabIndex={-1}
          className="mb-4 text-center text-sm font-medium outline-none"
        >
          Open a tab
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {workspacePanelKinds
            .filter((kind) => workspacePanelDefinitions[kind].launchable)
            .map((kind) => {
              const feature = workspacePanelDefinitions[kind];
              return (
                <Button
                  key={kind}
                  disabled={!workspacePanelDefinitions[kind].available}
                  variant="ghost"
                  className="h-auto min-h-20 min-w-0 flex-col items-start justify-center gap-2.5 whitespace-normal border-border bg-card px-3 py-3 text-left hover:border-foreground/20 sm:h-auto"
                  onClick={() => panel.execute({ type: "open", kind })}
                >
                  <span className="flex items-center gap-2 text-xs font-normal">
                    <feature.icon aria-hidden="true" className="size-3.5" />
                    {feature.label}
                  </span>
                  <span className="text-[10px] font-normal text-muted-foreground">
                    {feature.description}
                  </span>
                </Button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
