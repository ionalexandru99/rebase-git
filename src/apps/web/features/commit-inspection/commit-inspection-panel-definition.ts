import { isObjectId } from "@rebase/contracts";
import { IconGitCommit } from "@tabler/icons-react";
import { lazy } from "react";
import type { WorkspacePanelDefinition } from "#web/features/workspace-panel/workspace-panel-model";

export const commitInspectionPanel = {
  acceptsInput: isObjectId,
  Content: lazy(() =>
    import("#web/features/commit-inspection/commit-inspection-panel").then(
      (module) => ({ default: module.CommitInspectionPanel }),
    ),
  ),
  label: "Commit",
  icon: IconGitCommit,
  available: true,
  launchable: false,
  description: "Inspect a selected commit",
} satisfies WorkspacePanelDefinition;
