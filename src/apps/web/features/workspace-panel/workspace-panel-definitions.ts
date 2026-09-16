import {
  IconCode,
  IconFileDiff,
  IconGitCommit,
  IconGitPullRequest,
} from "@tabler/icons-react";
import type { WorkspacePanelDefinition } from "#web/features/workspace-panel/workspace-panel.contract";

const definitions = {
  commit: {
    label: "Commit",
    icon: IconGitCommit,
    available: true,
    lifetime: "selection",
    description: "Inspect a selected commit",
  },
  changes: {
    label: "Diffs",
    icon: IconFileDiff,
    available: true,
    lifetime: "persistent",
    description: "Review and commit working changes",
  },
  code: {
    label: "Code",
    icon: IconCode,
    available: false,
    lifetime: "persistent",
    description: "Coming soon",
  },
  "pull-request": {
    label: "Pull requests",
    icon: IconGitPullRequest,
    available: false,
    lifetime: "persistent",
    description: "Coming soon",
  },
} satisfies Record<string, WorkspacePanelDefinition>;

export type WorkspacePanelKind = keyof typeof definitions;
export const workspacePanelDefinitions: Readonly<
  Record<WorkspacePanelKind, WorkspacePanelDefinition>
> = definitions;
export const workspacePanelKinds = Object.keys(
  definitions,
) as WorkspacePanelKind[];
