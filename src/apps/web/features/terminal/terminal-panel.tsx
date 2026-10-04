import {
  IconLayoutBottombarCollapse,
  IconLayoutBottombarExpand,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconPlus,
  IconTerminal,
  IconX,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useRef } from "react";
import { usePanelRef } from "react-resizable-panels";
import { Button } from "#web/components/ui/button.tsx";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web/components/ui/resizable.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "#web/components/ui/tabs.tsx";
import {
  isTerminalShortcut,
  TerminalView,
} from "#web/features/terminal/terminal-view.tsx";
import type { Terminals } from "#web/features/terminal/use-terminals.ts";
import { cn } from "#web/lib/utils.ts";

export function TerminalSplit({
  terminals,
  children,
}: {
  readonly terminals: Terminals;
  readonly children: ReactNode;
}) {
  const panelRef = usePanelRef();
  const { open, size } = terminals;
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    if (open && panel.isCollapsed()) panel.resize(`${size}%`);
    if (!open && !panel.isCollapsed()) panel.collapse();
  }, [open, size, panelRef]);
  return (
    <ResizablePanelGroup
      orientation="vertical"
      onLayoutChanged={(layout, { isUserInteraction }) => {
        const terminal = layout.terminal;
        if (!isUserInteraction || terminal === undefined) return;
        if (terminal === 0) terminals.hide();
        else terminals.resize(terminal);
      }}
    >
      <ResizablePanel id="graph" minSize="20%">
        {children}
      </ResizablePanel>
      <ResizableHandle
        aria-label="Resize terminal"
        className={cn(
          "z-10 focus-visible:ring-primary/40",
          open ? undefined : "hidden",
        )}
      />
      <ResizablePanel
        id="terminal"
        panelRef={panelRef}
        collapsible
        collapsedSize={0}
        minSize="6rem"
        defaultSize={open ? `${size}%` : 0}
      >
        {terminals.terminals.length > 0 ? (
          <TerminalPane key={terminals.worktreePath} terminals={terminals} />
        ) : null}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function TerminalPane({ terminals }: { readonly terminals: Terminals }) {
  const { active, collapsed, focus } = terminals;
  return (
    <Tabs
      orientation="vertical"
      value={active}
      onValueChange={(id) => {
        if (typeof id === "string") terminals.select(id);
      }}
      data-terminal-pane
      className="h-full flex-row bg-repository"
    >
      <section aria-label="Terminal" className="relative min-w-0 flex-1">
        {terminals.terminals.map(({ id }) => (
          <TabsContent
            key={id}
            value={id}
            keepMounted
            className="absolute inset-0 py-1.5 pl-3 data-[hidden]:hidden"
          >
            <TerminalView id={id} visible={id === active} focus={focus} />
          </TabsContent>
        ))}
      </section>
      <div
        className={cn(
          "flex flex-none flex-col gap-0.5 border-border border-l p-1.5",
          collapsed ? "w-10 items-center" : "w-45",
        )}
      >
        <div className="flex justify-end">
          <Button
            aria-label={
              collapsed ? "Expand terminal list" : "Collapse terminal list"
            }
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => terminals.collapse(!collapsed)}
          >
            {collapsed ? (
              <IconLayoutSidebarRightExpand aria-hidden="true" />
            ) : (
              <IconLayoutSidebarRightCollapse aria-hidden="true" />
            )}
          </Button>
        </div>
        <TabsList
          aria-label="Terminals"
          className="flex-col items-stretch gap-0.5"
        >
          {terminals.terminals.map(({ id, number }) => (
            <TerminalTab
              key={id}
              id={id}
              number={number}
              collapsed={collapsed}
              onSelect={() => terminals.select(id)}
              onClose={() => terminals.close(id)}
            />
          ))}
        </TabsList>
        {collapsed ? (
          <Button
            aria-label="New terminal"
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => void terminals.create()}
          >
            <IconPlus aria-hidden="true" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="justify-start gap-2 px-2 font-normal text-muted-foreground"
            onClick={() => void terminals.create()}
          >
            <IconPlus aria-hidden="true" className="size-3.5" />
            New terminal
          </Button>
        )}
      </div>
    </Tabs>
  );
}

function TerminalTab({
  id,
  number,
  collapsed,
  onSelect,
  onClose,
}: {
  readonly id: string;
  readonly number: number;
  readonly collapsed: boolean;
  readonly onSelect: () => void;
  readonly onClose: () => void;
}) {
  const label = `Terminal ${number}`;
  if (collapsed)
    return (
      <TabsTrigger
        value={id}
        aria-label={label}
        onClick={onSelect}
        className="size-7 rounded-md font-mono hover:bg-accent/60 hover:text-foreground data-active:bg-accent"
      >
        {number}
      </TabsTrigger>
    );
  return (
    <div className="group/tab relative flex">
      <TabsTrigger
        value={id}
        onClick={onSelect}
        className="h-7 flex-1 justify-start rounded-md pr-7 pl-2 text-sm hover:bg-accent/60 hover:text-foreground data-active:bg-accent"
      >
        <IconTerminal aria-hidden="true" className="size-3.5" />
        {label}
      </TabsTrigger>
      <Button
        aria-label={`Close ${label}`}
        variant="ghost"
        size="icon-xs"
        className="absolute top-1.5 right-1.5 size-4 text-muted-foreground opacity-0 group-focus-within/tab:opacity-100 group-hover/tab:opacity-100 sm:size-4"
        onClick={onClose}
      >
        <IconX aria-hidden="true" className="size-3" />
      </Button>
    </div>
  );
}

export function TerminalToggle({
  terminals,
}: {
  readonly terminals: Terminals;
}) {
  const button = useRef<HTMLButtonElement>(null);
  const latest = useRef(terminals);
  latest.current = terminals;
  const { toggle, open } = terminals;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isTerminalShortcut(event)) return;
      event.preventDefault();
      const current = latest.current;
      if (event.shiftKey) {
        void current.create();
        return;
      }
      if (
        current.open &&
        document.activeElement?.closest("[data-terminal-pane]")
      )
        button.current?.focus();
      current.toggle();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
  return (
    <Button
      ref={button}
      aria-label={open ? "Hide terminal" : "Show terminal"}
      aria-expanded={open}
      variant="ghost"
      size="icon-sm"
      className="border-0 bg-transparent shadow-none aria-expanded:bg-transparent"
      onClick={toggle}
    >
      {open ? (
        <IconLayoutBottombarCollapse aria-hidden="true" />
      ) : (
        <IconLayoutBottombarExpand aria-hidden="true" />
      )}
    </Button>
  );
}
