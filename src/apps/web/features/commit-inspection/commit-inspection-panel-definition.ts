import { InspectCommit } from "@rebase/contracts";
import { IconGitCommit } from "@tabler/icons-react";
import { Schema } from "effect";
import { lazy } from "react";
import type { WorkspacePanelDefinition } from "#web-ui/features/workspace-panel/index";

export const commitInspectionPanel = {
  acceptsInput: Schema.is(InspectCommit.fields.oid),
  Content: lazy(() =>
    import("#web-ui/features/commit-inspection/commit-inspection-panel").then(
      (module) => ({ default: module.CommitInspectionPanel }),
    ),
  ),
  label: "Commit",
  icon: IconGitCommit,
  available: true,
  launchable: false,
  description: "Inspect a selected commit",
} satisfies WorkspacePanelDefinition;
