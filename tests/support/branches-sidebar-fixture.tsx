import type { ComponentProps } from "react";
import {
  noCompareActions,
  noMergeActions,
  noPullRequests,
  noRebaseActions,
  noResetActions,
} from "#tests-support/workspace-actions.ts";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar.tsx";

const ignored = () => undefined;

export function BranchesSidebarFixture(
  props: Partial<ComponentProps<typeof BranchesSidebar>>,
) {
  return (
    <BranchesSidebar
      history={undefined}
      merge={noMergeActions}
      pullRequests={noPullRequests}
      rebase={noRebaseActions}
      reset={noResetActions}
      compare={noCompareActions}
      onBranchRenamed={ignored}
      onToggleHistoryRef={ignored}
      onShowReflog={ignored}
      onOpenStash={ignored}
      selectedHistoryRefKeys={new Set()}
      {...props}
    />
  );
}
