import type { RepositoryRefTarget } from "@rebase/contracts";
import type { JSX } from "react";
import { useEffect, useMemo, useState } from "react";
import { resolveAutomaticHistoryRoots } from "#web/features/repository-history/automatic-history-roots";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import type {
  RepositoryHistoryGateway,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryRefsSnapshot } from "#web/features/repository-refs/repository-refs-controller.contract";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "#web-ui/components/ui/resizable";
import { BranchesSidebar } from "#web-ui/features/branches-sidebar/branches-sidebar";
import { CommitGraph } from "#web-ui/features/commit-graph/commit-graph";

const branchesSidebarSize = {
  default: "16.5rem",
  max: "26rem",
  min: "12rem",
} as const;

export function RepositoryWorkspace({
  activeWorktreePath,
  branchesFocusRequest,
  environmentId,
  historyGateway,
  refs,
  repositoryId,
  repositoryName,
  retryRefs,
  selectRef,
}: {
  readonly activeWorktreePath: string;
  readonly branchesFocusRequest: number;
  readonly environmentId: string | undefined;
  readonly historyGateway: RepositoryHistoryGateway;
  readonly refs: RepositoryRefsSnapshot;
  readonly repositoryId: string | undefined;
  readonly repositoryName: string;
  readonly retryRefs: () => void;
  readonly selectRef: (target: RepositoryRefTarget) => void;
}): JSX.Element {
  const [historyReader, setHistoryReader] = useState<RepositoryHistoryReader>();
  useEffect(() => {
    if (environmentId === undefined || repositoryId === undefined) {
      setHistoryReader(undefined);
      return;
    }
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: historyGateway,
      repositoryId,
    });
    setHistoryReader(reader);
    return () => {
      reader.close();
    };
  }, [environmentId, historyGateway, repositoryId]);
  const roots = useMemo(
    () =>
      refs.refs === undefined
        ? undefined
        : resolveAutomaticHistoryRoots(refs.refs, activeWorktreePath),
    [activeWorktreePath, refs.refs],
  );

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
      <ResizableHandle className="z-10 bg-transparent after:w-2 focus-visible:ring-primary/40" />
      <ResizablePanel id="workspace" minSize="30%">
        <main
          aria-label="Repository workspace"
          className="h-full rounded-none bg-repository"
        >
          <CommitGraph
            reader={historyReader}
            repositoryName={repositoryName}
            roots={roots}
          />
        </main>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
