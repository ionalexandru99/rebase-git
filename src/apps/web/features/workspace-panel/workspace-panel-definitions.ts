import {
  IconCode,
  IconFileDiff,
  IconGitCommit,
  IconGitPullRequest,
} from "@tabler/icons-react";
import { lazy } from "react";
import { isObjectId } from "#contracts/git/git-values.contract.ts";
import type { WorkspacePanelDefinition } from "#web/features/workspace-panel/workspace-panel-model.ts";

export const workingChangesPanel = {
  Content: lazy(() =>
    import("#web/features/working-changes/working-changes.tsx").then(
      (module) => ({ default: module.WorkingChangesPanel }),
    ),
  ),
  label: "Diffs",
  icon: IconFileDiff,
  available: true,
  launchable: true,
  description: "Review and commit working changes",
} satisfies WorkspacePanelDefinition;

const commitInspectionPanel = {
  acceptsInput: isObjectId,
  Content: lazy(() =>
    import("#web/features/commit-inspection/commit-inspection.tsx").then(
      (module) => ({ default: module.CommitInspectionPanel }),
    ),
  ),
  label: "Commit",
  icon: IconGitCommit,
  available: true,
  launchable: false,
  description: "Inspect a selected commit",
} satisfies WorkspacePanelDefinition;

const definitions = {
  commit: commitInspectionPanel,
  changes: workingChangesPanel,
  code: {
    label: "Code",
    icon: IconCode,
    available: false,
    launchable: true,
    description: "Coming soon",
  },
  "pull-request": {
    label: "Pull requests",
    icon: IconGitPullRequest,
    available: false,
    launchable: true,
    description: "Coming soon",
  },
} satisfies Record<string, WorkspacePanelDefinition>;

export type WorkspacePanelKind = keyof typeof definitions;
export type WorkspacePanelInputAction = {
  [Kind in WorkspacePanelKind]: (typeof definitions)[Kind] extends {
    readonly acceptsInput: (input: unknown) => input is infer Input;
  }
    ? { readonly type: "input"; readonly kind: Kind; readonly input: Input }
    : never;
}[WorkspacePanelKind];
export const workspacePanelDefinitions: Readonly<
  Record<WorkspacePanelKind, WorkspacePanelDefinition>
> = definitions;
export const workspacePanelKinds = Object.keys(
  definitions,
) as WorkspacePanelKind[];
