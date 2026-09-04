import type { RepositoryRefTarget } from "@rebase/contracts";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createBrowserHistoryFilterStore } from "#web/features/commit-graph/browser-history-filter-store";
import {
  automaticHistoryScope,
  historyScopesEqual,
  resolveHistoryScope,
  toggleHistoryRef,
} from "#web/features/commit-graph/history-scope";
import type { HistoryScope } from "#web/features/commit-graph/history-scope.contract";
import { createBrowserRepositoryHistoryReader } from "#web/features/repository-history/browser-repository-history-reader";
import type {
  RepositoryHistoryGateway,
  RepositoryHistoryReader,
} from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryRefsSnapshot } from "#web/features/repository-refs/repository-refs-controller.contract";
import { useCachedRepositoryRefs } from "#web/features/repository-refs/use-cached-repository-refs";
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
  logicalRepositoryId: catalogLogicalRepositoryId,
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
  readonly logicalRepositoryId?: string | undefined;
  readonly refs: RepositoryRefsSnapshot;
  readonly repositoryId: string | undefined;
  readonly repositoryName: string;
  readonly retryRefs: () => void;
  readonly selectRef: (target: RepositoryRefTarget) => void;
}): JSX.Element {
  const logicalRepositoryId =
    catalogLogicalRepositoryId ??
    refs.refs?.logicalRepositoryId ??
    repositoryId;
  const cachedRefs = useCachedRepositoryRefs(
    environmentId,
    logicalRepositoryId,
    repositoryId,
    refs,
  );
  return (
    <RepositoryWorkspaceContent
      activeWorktreePath={activeWorktreePath}
      branchesFocusRequest={branchesFocusRequest}
      environmentId={environmentId}
      historyGateway={historyGateway}
      key={`${environmentId ?? ""}\0${logicalRepositoryId ?? ""}`}
      logicalRepositoryId={logicalRepositoryId}
      refs={cachedRefs.snapshot}
      refsRestored={cachedRefs.restored}
      repositoryId={repositoryId}
      repositoryName={repositoryName}
      retryRefs={retryRefs}
      selectRef={selectRef}
    />
  );
}

function RepositoryWorkspaceContent({
  activeWorktreePath,
  branchesFocusRequest,
  environmentId,
  historyGateway,
  logicalRepositoryId,
  refs,
  refsRestored,
  repositoryId,
  repositoryName,
  retryRefs,
  selectRef,
}: {
  readonly activeWorktreePath: string;
  readonly branchesFocusRequest: number;
  readonly environmentId: string | undefined;
  readonly historyGateway: RepositoryHistoryGateway;
  readonly logicalRepositoryId: string | undefined;
  readonly refs: RepositoryRefsSnapshot;
  readonly refsRestored: boolean;
  readonly repositoryId: string | undefined;
  readonly repositoryName: string;
  readonly retryRefs: () => void;
  readonly selectRef: (target: RepositoryRefTarget) => void;
}): JSX.Element {
  const [historyReader, setHistoryReader] = useState<RepositoryHistoryReader>();
  const filterStore = useMemo(() => createBrowserHistoryFilterStore(), []);
  const [historyScope, setHistoryScope] = useState<HistoryScope>(() =>
    environmentId === undefined || logicalRepositoryId === undefined
      ? automaticHistoryScope
      : filterStore.load(environmentId, logicalRepositoryId),
  );
  useEffect(() => {
    if (
      environmentId === undefined ||
      repositoryId === undefined ||
      logicalRepositoryId === undefined
    ) {
      setHistoryReader(undefined);
      return;
    }
    const reader = createBrowserRepositoryHistoryReader({
      environmentId,
      gateway: historyGateway,
      logicalRepositoryId,
      repositoryId,
    });
    setHistoryReader(reader);
    return () => {
      reader.close();
    };
  }, [environmentId, historyGateway, logicalRepositoryId, repositoryId]);
  const resolvedScope = useMemo(
    () =>
      refs.refs === undefined
        ? undefined
        : resolveHistoryScope(historyScope, refs.refs, activeWorktreePath, {
            removeMissingSelections: !refsRestored,
          }),
    [activeWorktreePath, historyScope, refs.refs, refsRestored],
  );
  useEffect(() => {
    if (
      resolvedScope === undefined ||
      refsRestored ||
      historyScopesEqual(historyScope, resolvedScope.scope)
    ) {
      return;
    }
    setHistoryScope(resolvedScope.scope);
    if (environmentId !== undefined && logicalRepositoryId !== undefined) {
      filterStore.save(environmentId, logicalRepositoryId, resolvedScope.scope);
    }
  }, [
    environmentId,
    filterStore,
    historyScope,
    logicalRepositoryId,
    resolvedScope,
    refsRestored,
  ]);
  const toggleRef = useCallback(
    (target: RepositoryRefTarget) => {
      if (refs.refs === undefined) return;
      const next = resolveHistoryScope(
        toggleHistoryRef(historyScope, target, refs.refs, activeWorktreePath),
        refs.refs,
        activeWorktreePath,
      ).scope;
      setHistoryScope(next);
      if (environmentId !== undefined && logicalRepositoryId !== undefined) {
        filterStore.save(environmentId, logicalRepositoryId, next);
      }
    },
    [
      activeWorktreePath,
      environmentId,
      filterStore,
      historyScope,
      logicalRepositoryId,
      refs.refs,
    ],
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
          onToggleHistoryRef={toggleRef}
          selectedHistoryRefKeys={
            resolvedScope?.selectedRefKeys ?? new Set<string>()
          }
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
            onRemoveHistoryRef={toggleRef}
            reader={historyReader}
            repositoryName={repositoryName}
            roots={resolvedScope?.roots}
            scope={resolvedScope?.scope ?? automaticHistoryScope}
            selections={resolvedScope?.selections ?? []}
          />
        </main>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
