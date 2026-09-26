import { IconX } from "@tabler/icons-react";
import { Button } from "#web/components/ui/button";
import { TabsTrigger } from "#web/components/ui/tabs";
import type { WorkspacePanelKind } from "#web/features/workspace-panel/workspace-panel.contract";
import { workspacePanelDefinitions } from "#web/features/workspace-panel/workspace-panel-definitions";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider";
import { cn } from "#web/lib/utils";

export function WorkspacePanelTab({
  kind,
}: {
  readonly kind: WorkspacePanelKind;
}) {
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
