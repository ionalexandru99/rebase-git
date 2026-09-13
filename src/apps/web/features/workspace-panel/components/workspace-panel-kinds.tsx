import {
  IconCode,
  IconFileDiff,
  IconGitPullRequest,
} from "@tabler/icons-react";
import type { WorkspacePanelKind } from "#web/features/workspace-panel/workspace-panel.contract";

export const workspacePanelFeatures = {
  changes: { label: "Diffs", icon: IconFileDiff },
  code: { label: "Code", icon: IconCode },
  "pull-request": { label: "Pull requests", icon: IconGitPullRequest },
} as const satisfies Record<
  WorkspacePanelKind,
  { label: string; icon: typeof IconCode }
>;
