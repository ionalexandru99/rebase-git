import { IconFileDiff } from "@tabler/icons-react";
import { lazy } from "react";
import type { WorkspacePanelDefinition } from "#web-ui/features/workspace-panel/index";

export const workingChangesPanel = {
  Content: lazy(() =>
    import("#web-ui/features/working-changes/working-changes-panel").then(
      (module) => ({ default: module.WorkingChangesPanel }),
    ),
  ),
  label: "Diffs",
  icon: IconFileDiff,
  available: true,
  launchable: true,
  description: "Review and commit working changes",
} satisfies WorkspacePanelDefinition;
