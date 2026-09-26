import { IconCode, IconGitPullRequest } from "@tabler/icons-react";
import { commitInspectionPanel } from "#web/features/commit-inspection/commit-inspection-panel-definition";
import { workingChangesPanel } from "#web/features/working-changes/working-changes-panel-definition";
import type { WorkspacePanelDefinition } from "#web/features/workspace-panel/workspace-panel.contract";

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
