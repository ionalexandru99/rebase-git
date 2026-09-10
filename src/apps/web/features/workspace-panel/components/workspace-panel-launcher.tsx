import { IconPlus } from "@tabler/icons-react";
import { useRef } from "react";
import {
  keyboardShortcutAria,
  keyboardShortcutLabel,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import {
  workspacePanelAvailability,
  workspacePanelKinds,
} from "#web/features/workspace-panel/workspace-panel.contract";
import { Button } from "#web-ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "#web-ui/components/ui/dropdown-menu";
import { useKeyboardShortcuts } from "#web-ui/features/keyboard-shortcuts/keyboard-shortcuts-provider";
import { workspacePanelFeatures } from "#web-ui/features/workspace-panel/components/workspace-panel-kinds";
import { useWorkspacePanel } from "#web-ui/features/workspace-panel/workspace-panel-provider";

export function WorkspacePanelLauncher() {
  const panel = useWorkspacePanel();
  const { bindings, platform } = useKeyboardShortcuts();
  const openedTab = useRef(false);
  return (
    <DropdownMenu
      open={panel.launcherOpen}
      onOpenChange={panel.setLauncherOpen}
    >
      <DropdownMenuTrigger
        render={
          <Button
            ref={panel.launcherRef}
            aria-label="Open tab"
            aria-keyshortcuts={keyboardShortcutAria(
              bindings["workspacePanel.openTab"],
              platform,
            )}
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
          if (!openedTab.current) return panel.launcherRef.current;
          openedTab.current = false;
          return (
            panel.launcherRef.current
              ?.closest("[data-workspace-panel-tabs]")
              ?.querySelector<HTMLElement>('[aria-selected="true"]') ??
            panel.launcherRef.current
          );
        }}
      >
        <div className="flex items-center justify-between gap-3 px-2 py-2 text-[10px] text-muted-foreground">
          <span>Coming soon</span>
          <span>
            {keyboardShortcutLabel(
              bindings["workspacePanel.openTab"],
              platform,
            )}
          </span>
        </div>
        {workspacePanelKinds.map((kind) => {
          const feature = workspacePanelFeatures[kind];
          return (
            <DropdownMenuItem
              key={kind}
              disabled={!workspacePanelAvailability[kind]}
              onClick={() => {
                openedTab.current = true;
                panel.setLauncherOpen(false);
                panel.execute({ type: "open", kind });
              }}
            >
              <feature.icon aria-hidden="true" />
              {feature.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
