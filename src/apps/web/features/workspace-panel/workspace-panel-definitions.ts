import {
  IconArrowsLeftRight,
  IconFileDiff,
  IconFileTime,
  IconFolder,
  IconGitCommit,
  IconHistory,
  IconListDetails,
  IconStack2,
} from "@tabler/icons-react";
import { lazy } from "react";
import { isReflogRef } from "#contracts/repository-reflog/repository-reflog.contract.ts";
import { isCommitInput } from "#web/features/commit-inspection/commit-input.ts";
import {
  compareTab,
  isCompareInput,
} from "#web/features/comparison/comparison.ts";
import {
  fileHistoryTab,
  isFileHistoryInput,
} from "#web/features/file-history/file-history.ts";
import { isRebasePlanTarget } from "#web/features/rebase/rebase-plan.ts";
import { isStashInput } from "#web/features/stashes/stashes.ts";
import { isShowChangeInput } from "#web/features/working-changes/show-change.ts";
import type { WorkspacePanelDefinition } from "#web/features/workspace-panel/workspace-panel-model.ts";

export const workingChangesPanel = {
  acceptsInput: isShowChangeInput,
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

export const worktreeFilesPanel = {
  Content: lazy(() =>
    import("#web/features/worktree-files/worktree-files-panel.tsx").then(
      (module) => ({ default: module.WorktreeFilesPanel }),
    ),
  ),
  label: "Files",
  icon: IconFolder,
  launchable: true,
  description: "Browse the worktree's files",
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
  acceptsInput: isCommitInput,
  Content: lazy(() =>
    import("#web/features/commit-inspection/commit-inspection.tsx").then(
      (module) => ({ default: module.CommitInspectionPanel }),
    ),
  ),
  label: "Commit",
  icon: IconGitCommit,
  launchable: false,
} satisfies WorkspacePanelDefinition;

const stashPanel = {
  acceptsInput: isStashInput,
  Content: lazy(() =>
    import("#web/features/stashes/stash-panel.tsx").then((module) => ({
      default: module.StashPanel,
    })),
  ),
  label: "Stash",
  icon: IconStack2,
  launchable: false,
} satisfies WorkspacePanelDefinition;

export const fileHistoryPanel = {
  acceptsInput: isFileHistoryInput,
  instance: fileHistoryTab,
  Content: lazy(() =>
    import("#web/features/file-history/file-history-panel.tsx").then(
      (module) => ({ default: module.FileHistoryPanel }),
    ),
  ),
  label: "History",
  icon: IconFileTime,
  launchable: false,
} satisfies WorkspacePanelDefinition;

export const comparePanel = {
  acceptsInput: isCompareInput,
  instance: compareTab,
  Content: lazy(() =>
    import("#web/features/comparison/comparison-panel.tsx").then((module) => ({
      default: module.ComparisonPanel,
    })),
  ),
  label: "Compare",
  icon: IconArrowsLeftRight,
  launchable: false,
} satisfies WorkspacePanelDefinition;

const definitions = {
  commit: commitInspectionPanel,
  history: fileHistoryPanel,
  compare: comparePanel,
  changes: workingChangesPanel,
  files: worktreeFilesPanel,
  reflog: reflogPanel,
  rebase: rebasePanel,
  stash: stashPanel,
} satisfies Record<string, WorkspacePanelDefinition>;

export type WorkspacePanelKind = keyof typeof definitions;
type PanelInput<Kind extends WorkspacePanelKind> =
  (typeof definitions)[Kind] extends {
    readonly acceptsInput: (input: unknown) => input is infer Input;
  }
    ? Input
    : never;
type InstanceKind = {
  [Kind in WorkspacePanelKind]: (typeof definitions)[Kind] extends {
    readonly instance: unknown;
  }
    ? Kind
    : never;
}[WorkspacePanelKind];
export type SingleWorkspacePanelKind = Exclude<
  WorkspacePanelKind,
  InstanceKind
>;
export type WorkspacePanelInputAction = {
  [Kind in SingleWorkspacePanelKind]: [PanelInput<Kind>] extends [never]
    ? never
    : {
        readonly type: "input";
        readonly kind: Kind;
        readonly input: PanelInput<Kind>;
      };
}[SingleWorkspacePanelKind];
export type WorkspacePanelOpenAction =
  | { readonly type: "open"; readonly kind: SingleWorkspacePanelKind }
  | {
      [Kind in InstanceKind]: {
        readonly type: "open";
        readonly kind: Kind;
        readonly input: PanelInput<Kind>;
      };
    }[InstanceKind];
export type WorkspacePanelReplaceAction = {
  [Kind in InstanceKind]: {
    readonly type: "replace";
    readonly kind: Kind;
    readonly previous: PanelInput<Kind>;
    readonly input: PanelInput<Kind>;
  };
}[InstanceKind];
export const workspacePanelDefinitions: Readonly<
  Record<WorkspacePanelKind, WorkspacePanelDefinition>
> = definitions;
export const workspacePanelKinds = Object.keys(
  definitions,
) as WorkspacePanelKind[];
export const launchablePanels = workspacePanelKinds.flatMap((kind) => {
  const definition = workspacePanelDefinitions[kind];
  return definition.launchable && isSingleKind(kind)
    ? [{ kind, definition }]
    : [];
});

export function isSingleKind(
  kind: WorkspacePanelKind,
): kind is SingleWorkspacePanelKind {
  return workspacePanelDefinitions[kind].instance === undefined;
}
