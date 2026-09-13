import {
  workspacePanelAvailability,
  workspacePanelKinds,
} from "#web/features/workspace-panel/workspace-panel.contract";
import { Button } from "#web-ui/components/ui/button";
import { workspacePanelFeatures } from "#web-ui/features/workspace-panel/components/workspace-panel-kinds";
import { useWorkspacePanel } from "#web-ui/features/workspace-panel/workspace-panel-provider";

export function WorkspacePanelEmptyState() {
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
          {workspacePanelKinds.map((kind) => {
            const feature = workspacePanelFeatures[kind];
            return (
              <Button
                key={kind}
                disabled={!workspacePanelAvailability[kind]}
                variant="ghost"
                className="h-auto min-h-20 min-w-0 flex-col items-start justify-center gap-2.5 whitespace-normal border-border bg-card px-3 py-3 text-left hover:border-foreground/20 sm:h-auto"
                onClick={() => panel.execute({ type: "open", kind })}
              >
                <span className="flex items-center gap-2 text-xs font-normal">
                  <feature.icon aria-hidden="true" className="size-3.5" />
                  {feature.label}
                </span>
                <span className="text-[10px] font-normal text-muted-foreground">
                  {workspacePanelAvailability[kind]
                    ? "Review and commit working changes"
                    : "Coming soon"}
                </span>
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
