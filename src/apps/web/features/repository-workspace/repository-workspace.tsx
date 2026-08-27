import type { RepositoryRefTarget } from "@rebase/contracts";
import type { JSX } from "react";
import type { RepositoryRefsSnapshot } from "#web/features/repository-refs/repository-refs-controller.contract";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web-ui/components/ui/resizable";
import { BranchesSidebar } from "#web-ui/features/branches-sidebar/branches-sidebar";

const branchesSidebarSize = {
  default: "16.5rem",
  max: "26rem",
  min: "12rem",
} as const;

export function RepositoryWorkspace({
  activeWorktreePath,
  branchesFocusRequest,
  refs,
  retryRefs,
  selectRef,
}: {
  readonly activeWorktreePath: string;
  readonly branchesFocusRequest: number;
  readonly refs: RepositoryRefsSnapshot;
  readonly retryRefs: () => void;
  readonly selectRef: (target: RepositoryRefTarget) => void;
}): JSX.Element {
  return (
    <ResizablePanelGroup className="h-full min-h-0" orientation="horizontal">
      <ResizablePanel
        defaultSize={branchesSidebarSize.default}
        groupResizeBehavior="preserve-pixel-size"
        id="branches"
        maxSize={branchesSidebarSize.max}
        minSize={branchesSidebarSize.min}
      >
        <BranchesSidebar
          activeWorktreePath={activeWorktreePath}
          focusRequest={branchesFocusRequest}
          onRetry={retryRefs}
          onSelectRef={selectRef}
          snapshot={refs}
        />
      </ResizablePanel>
      <ResizableHandle className="bg-transparent after:w-2 focus-visible:ring-primary/40" />
      <ResizablePanel id="workspace" minSize="30%">
        <main
          aria-label="Repository workspace"
          className="h-full rounded-none bg-repository"
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
