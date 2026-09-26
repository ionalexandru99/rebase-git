import { IconFileDiff } from "@tabler/icons-react";
import { lazy } from "react";
import type { WorkspacePanelDefinition } from "#web/features/workspace-panel/workspace-panel.contract";

export const workingChangesPanel = {
  Content: lazy(() =>
    import("#web/features/working-changes/working-changes-panel").then(
      (module) => ({ default: module.WorkingChangesPanel }),
    ),
  ),
  label: "Diffs",
  icon: IconFileDiff,
  available: true,
  launchable: true,
  description: "Review and commit working changes",
} satisfies WorkspacePanelDefinition;
