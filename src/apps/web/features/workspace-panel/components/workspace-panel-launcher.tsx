import { IconPlus } from "@tabler/icons-react";
import { useRef } from "react";
import { Button } from "#web/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#web/components/ui/dropdown-menu.tsx";
import { launchablePanels } from "#web/features/workspace-panel/workspace-panel-definitions.ts";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider.tsx";

export function WorkspacePanelLauncher() {
  const { launcherOpen, setLauncherOpen, launcherRef, execute } =
    useWorkspacePanel();
  const openedTab = useRef(false);
  return (
    <DropdownMenu open={launcherOpen} onOpenChange={setLauncherOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            ref={launcherRef}
            aria-label="Open tab"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground"
          />
        }
      >
        <IconPlus aria-hidden="true" className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        finalFocus={() => {
          if (!openedTab.current) return launcherRef.current;
          openedTab.current = false;
          return (
            launcherRef.current
              ?.closest("[data-workspace-panel-tabs]")
              ?.querySelector<HTMLElement>('[aria-selected="true"]') ??
            launcherRef.current
          );
        }}
      >
        {launchablePanels.map(({ kind, definition }) => (
          <DropdownMenuItem
            key={kind}
            onClick={() => {
              openedTab.current = true;
              setLauncherOpen(false);
              execute({ type: "open", kind });
            }}
          >
            <definition.icon aria-hidden="true" />
            {definition.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
