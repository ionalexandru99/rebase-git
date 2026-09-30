import {
  IconFileDiff,
  IconGitCommit,
  IconHistory,
  IconListDetails,
} from "@tabler/icons-react";
import { lazy } from "react";
import { isObjectId } from "#contracts/git/git-values.contract.ts";
import { isReflogRef } from "#contracts/repository-reflog/repository-reflog.contract.ts";
import { isRebasePlanTarget } from "#web/features/rebase/rebase-plan.ts";
import type { WorkspacePanelDefinition } from "#web/features/workspace-panel/workspace-panel-model.ts";

export const workingChangesPanel = {
  Content: lazy(() =>
    import("#web/features/working-changes/working-changes.tsx").then(
      (module) => ({ default: module.WorkingChangesPanel }),
    ),
  ),
  label: "Diffs",
  icon: IconFileDiff,
  launchable: true,
  description: "Review and commit working changes",
} satisfies WorkspacePanelDefinition;

export const reflogPanel = {
  acceptsInput: isReflogRef,
  Content: lazy(() =>
    import("#web/features/reflog/reflog-panel.tsx").then((module) => ({
      default: module.ReflogPanel,
    })),
  ),
  label: "Reflog",
  icon: IconHistory,
  launchable: true,
  description: "Find where branches pointed before",
} satisfies WorkspacePanelDefinition;

export const rebasePanel = {
  acceptsInput: isRebasePlanTarget,
  Content: lazy(() =>
    import("#web/features/rebase/rebase-panel.tsx").then((module) => ({
      default: module.RebasePanel,
    })),
  ),
  label: "Rebase",
  icon: IconListDetails,
  launchable: false,
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
  launchable: false,
} satisfies WorkspacePanelDefinition;

const definitions = {
  commit: commitInspectionPanel,
  changes: workingChangesPanel,
  reflog: reflogPanel,
  rebase: rebasePanel,
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
export const launchablePanels = workspacePanelKinds.flatMap((kind) => {
  const definition = workspacePanelDefinitions[kind];
  return definition.launchable ? [{ kind, definition }] : [];
});
