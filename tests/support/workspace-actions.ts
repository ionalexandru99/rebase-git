import type { ComponentProps } from "react";
import type { CherryPick } from "#web/features/cherry-pick/cherry-pick-menu.tsx";
import type { CommitGraph } from "#web/features/commit-graph/commit-graph.tsx";
import type { CompareActions } from "#web/features/comparison/comparison.ts";
import type { MergeActions } from "#web/features/merge/merge-actions.ts";
import type { PullRequests } from "#web/features/pull-requests/pull-requests.tsx";
import type { RebaseActions } from "#web/features/rebase/rebase-actions.ts";
import type { RewriteCommits } from "#web/features/rebase/rewrite-commits.tsx";
import type { ResetActions } from "#web/features/reset/reset-actions.tsx";

const ignored = () => undefined;

export const noMergeActions: MergeActions = {
  actionFor: ignored,
  inspect: ignored,
};

export const noRebaseActions: RebaseActions = {
  actionFor: ignored,
  inspect: ignored,
  moving: () => [],
};

export const noResetActions: Pick<ResetActions, "actionFor"> = {
  actionFor: ignored,
};

export const noCompareActions: CompareActions = {
  actionFor: ignored,
  pairFor: ignored,
};

export const noCherryPick: Pick<CherryPick, "action" | "open"> = {
  action: ignored,
  open: ignored,
};

export const noRewriteCommits: Pick<RewriteCommits, "actions" | "open"> = {
  actions: () => [],
  open: ignored,
};

export const noPullRequests: PullRequests = {
  kind: "PullRequest",
  forBranch: () => [],
  actionsFor: () => [],
};

export const noCommitGraphActions = {
  merge: noMergeActions,
  rebase: noRebaseActions,
  reset: noResetActions,
  compare: noCompareActions,
  cherryPick: noCherryPick,
  rewrite: noRewriteCommits,
  onOpenDetails: ignored,
  onOpenCodeMatch: ignored,
  onOpenChanges: ignored,
  onActiveCommitChange: ignored,
  titleActions: null,
  toolbarActions: null,
  toolbarInset: false,
  remoteProviders: undefined,
} satisfies Partial<ComponentProps<typeof CommitGraph>>;
