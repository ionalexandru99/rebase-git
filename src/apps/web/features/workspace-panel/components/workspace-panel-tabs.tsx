import { IconX } from "@tabler/icons-react";
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
  HorizontalScrollButton,
  horizontalScrollViewport,
  useHorizontalScroll,
} from "#web/components/ui/horizontal-scroll.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "#web/components/ui/tabs.tsx";
import { WorkspacePanelLauncher } from "#web/features/workspace-panel/components/workspace-panel-launcher.tsx";
import {
  launchablePanels,
  type WorkspacePanelKind,
  workspacePanelDefinitions,
} from "#web/features/workspace-panel/workspace-panel-definitions.ts";
import type {
  WorkspacePanelState,
  WorkspacePanelTab,
} from "#web/features/workspace-panel/workspace-panel-model.ts";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider.tsx";
import { PanelSessionTarget } from "#web/features/workspace-panel/workspace-panel-sessions.tsx";
import { tabKind } from "#web/features/workspace-panel/workspace-panel-state.ts";
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
  const { viewport, content, edges, measure, scroll } = useHorizontalScroll();
  const labels = tabLabels(panel.state);
  useLayoutEffect(() => {
    if (active === null) return;
    const tab = listRef.current?.querySelector<HTMLElement>(
      '[aria-selected="true"]',
    );
    tab?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (focusWasLost()) tab?.focus();
  }, [active]);
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
      onValueChange={(tab) => {
        if (typeof tab === "string") panel.execute({ type: "select", tab });
      }}
      className="flex h-full min-h-0 flex-col bg-background text-foreground"
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-border border-b pr-26 pl-2">
        <div className="relative h-full min-w-0 flex-1">
          <section
            ref={viewport}
            aria-label="Side panel tab bar"
            className={`${horizontalScrollViewport} scroll-px-5`}
            onScroll={measure}
            tabIndex={-1}
          >
            <div ref={content} className="flex h-full w-max items-center gap-1">
              {tabs.length > 0 ? (
                <>
                  <TabsList
                    ref={listRef}
                    aria-label="Side panel tabs"
                    activateOnFocus
                    className="shrink-0 gap-1"
                  >
                    {tabs.map((tab) => (
                      <PanelTab
                        key={tab}
                        tab={tab}
                        label={labels.get(tab) ?? tab}
                      />
                    ))}
                  </TabsList>
                  <WorkspacePanelLauncher />
                </>
              ) : null}
            </div>
          </section>
          {edges.left ? (
            <HorizontalScrollButton
              direction={-1}
              label="Scroll tabs left"
              background="bg-background"
              onScroll={scroll}
            />
          ) : null}
          {edges.right ? (
            <HorizontalScrollButton
              direction={1}
              label="Scroll tabs right"
              background="bg-background"
              onScroll={scroll}
            />
          ) : null}
        </div>
      </div>
      {tabs.map((tab) => {
        return (
          <TabsContent
            key={tab}
            value={tab}
            keepMounted
            className="min-h-0 flex-1 overflow-hidden data-[hidden]:hidden"
          >
            <PanelSessionTarget session={panel.session} tab={tab}>
              {contents?.[tabKind(tab)]}
            </PanelSessionTarget>
          </TabsContent>
        );
      })}
      {active === null ? <WorkspacePanelEmptyState /> : null}
    </Tabs>
  );
}

function PanelTab({
  tab,
  label,
}: {
  readonly tab: WorkspacePanelTab;
  readonly label: string;
}) {
  const panel = useWorkspacePanel();
  const feature = workspacePanelDefinitions[tabKind(tab)];
  const active = panel.state.active === tab;
  const extension = label.lastIndexOf(".");
  return (
    <div
      className={cn(
        "group/tab flex h-6 max-w-36 shrink-0 items-center gap-1 rounded-control pl-1.5 text-meta",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      <Button
        aria-label={`Close ${label} tab`}
        size="icon-xs"
        variant="ghost"
        className="size-4 text-inherit hover:bg-muted sm:size-4"
        onClick={() => panel.execute({ type: "close", tab })}
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
        value={tab}
        aria-label={label}
        className="h-full min-w-0 rounded-control pr-2 text-inherit"
        onKeyDown={(event) => {
          if (event.key === "Delete") {
            event.preventDefault();
            panel.execute({ type: "close", tab });
          }
        }}
      >
        {extension > 0 ? (
          <span className="flex min-w-0">
            <span className="truncate">{label.slice(0, extension)}</span>
            <span className="shrink-0">{label.slice(extension)}</span>
          </span>
        ) : (
          <span className="truncate">{label}</span>
        )}
      </TabsTrigger>
    </div>
  );
}

function WorkspacePanelEmptyState() {
  const { emptyStateRef, execute } = useWorkspacePanel();
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-8">
      <div className="my-auto w-full max-w-100 self-center">
        <h2
          ref={emptyStateRef}
          tabIndex={-1}
          className="mb-4 text-center text-control font-medium outline-none"
        >
          Open a tab
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {launchablePanels.map(({ kind, definition }) => (
            <Button
              key={kind}
              variant="ghost"
              className="h-auto min-h-20 min-w-0 flex-col items-start justify-center gap-2.5 whitespace-normal border-border bg-card px-3 py-3 text-left hover:border-foreground/20 sm:h-auto"
              onClick={() => execute({ type: "open", kind })}
            >
              <span className="flex items-center gap-2 text-meta font-normal">
                <definition.icon aria-hidden="true" className="size-3.5" />
                {definition.label}
              </span>
              <span className="text-badge font-normal text-muted-foreground">
                {definition.description}
              </span>
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function tabLabels(state: WorkspacePanelState) {
  const instances = state.tabs.map((tab) => ({
    tab,
    kind: tabKind(tab),
    instance: workspacePanelDefinitions[tabKind(tab)].instance?.(
      state.inputs?.[tab],
    ),
  }));
  return new Map(
    instances.map(({ tab, kind, instance }) => {
      if (instance === undefined)
        return [tab, workspacePanelDefinitions[kind].label];
      const twin = instances.some(
        (other) =>
          other.tab !== tab &&
          other.kind === kind &&
          other.instance?.title === instance.title,
      );
      return [
        tab,
        twin && instance.context !== ""
          ? `${instance.context}/${instance.title}`
          : instance.title,
      ];
    }),
  );
}

function focusWasLost() {
  const focused = document.activeElement;
  return (
    focused === null ||
    focused === document.body ||
    focused.closest('[role="menu"]') !== null ||
    !focused.checkVisibility()
  );
}
