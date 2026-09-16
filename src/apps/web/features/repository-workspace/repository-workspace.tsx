import type {
  EnvironmentAccessCapability,
  RepositoryRefTarget,
} from "@rebase/contracts";
import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { HistoryScope } from "#web/features/commit-graph/index";
import {
  automaticHistoryScope,
  CommitGraph,
  createBrowserHistoryFilterStore,
  historyScopesEqual,
  resolveHistoryScope,
  toggleHistoryRef,
} from "#web/features/commit-graph/index";
import {
  CommitInspectionBridge,
  type CommitInspectionClient,
} from "#web/features/commit-inspection/index";
import type { RepositoryHistoryReader } from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryRefsSnapshot } from "#web/features/repository-refs/repository-refs-controller.contract";
import { useCachedRepositoryRefs } from "#web/features/repository-refs/use-cached-repository-refs";
import { useHistoryRefRefresh } from "#web/features/repository-workspace/use-history-ref-refresh";
import {
  type RepositoryChangesClient,
  WorkingChanges,
} from "#web/features/working-changes/index";
import {
  ResizableHandle,
  ResizablePanel,
} from "#web-ui/components/ui/resizable";
import { BranchesSidebar } from "#web-ui/features/branches-sidebar/branches-sidebar";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";

const branchesSidebarSize = {
  default: "16.5rem",
  max: "26rem",
  min: "12rem",
} as const;

export function RepositoryWorkspace({
  changesClient,
  inspectionClient,
  accessCapabilities = [],
  connected = false,
  activeWorktreePath,
  environmentId,
  historyReader,
  logicalRepositoryId: catalogLogicalRepositoryId,
  refs,
  repositoryId,
  repositoryName,
  retryRefs,
  selectRef,
}: {
  readonly inspectionClient?: CommitInspectionClient | undefined;
  readonly changesClient?: RepositoryChangesClient | undefined;
  readonly accessCapabilities?: readonly EnvironmentAccessCapability[];
  readonly connected?: boolean;
  readonly activeWorktreePath: string;
  readonly environmentId: string | undefined;
  readonly historyReader: RepositoryHistoryReader | undefined;
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
      changesClient={changesClient}
      inspectionClient={inspectionClient}
      accessCapabilities={accessCapabilities}
      connected={connected}
      activeWorktreePath={activeWorktreePath}
      environmentId={environmentId}
      historyReader={historyReader}
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
  changesClient,
  inspectionClient,
  accessCapabilities,
  connected,
  activeWorktreePath,
  environmentId,
  historyReader,
  logicalRepositoryId,
  refs,
  refsRestored,
  repositoryId,
  repositoryName,
  retryRefs,
  selectRef,
}: {
  readonly accessCapabilities: readonly EnvironmentAccessCapability[];
  readonly inspectionClient: CommitInspectionClient | undefined;
  readonly changesClient: RepositoryChangesClient | undefined;
  readonly connected: boolean;
  readonly activeWorktreePath: string;
  readonly environmentId: string | undefined;
  readonly historyReader: RepositoryHistoryReader | undefined;
  readonly logicalRepositoryId: string | undefined;
  readonly refs: RepositoryRefsSnapshot;
  readonly refsRestored: boolean;
  readonly repositoryId: string | undefined;
  readonly repositoryName: string;
  readonly retryRefs: () => void;
  readonly selectRef: (target: RepositoryRefTarget) => void;
}): JSX.Element {
  const [localBranchesFocusRequest, setLocalBranchesFocusRequest] = useState(0);
  useHistoryRefRefresh(historyReader, connected, retryRefs);
  const activeBranch = refs.refs?.worktrees.find(
    ({ path }) => path === activeWorktreePath,
  )?.head.branch;
  const filterStore = useMemo(() => createBrowserHistoryFilterStore(), []);
  const [historyScope, setHistoryScope] = useState<HistoryScope>(() =>
    environmentId === undefined || logicalRepositoryId === undefined
      ? automaticHistoryScope
      : filterStore.load(environmentId, logicalRepositoryId),
  );
  const resolvedScope = useMemo(
    () =>
      refs.refs === undefined
        ? undefined
        : resolveHistoryScope(historyScope, refs.refs, activeWorktreePath, {
            removeMissingSelections: !refsRestored,
          }),
    [activeWorktreePath, historyScope, refs.refs, refsRestored],
  );
  const canResetHistoryScope = useMemo(() => {
    if (refs.refs === undefined || resolvedScope === undefined) return false;
    const automatic = resolveHistoryScope(
      automaticHistoryScope,
      refs.refs,
      activeWorktreePath,
    );
    return !historyScopesEqual(
      { _tag: "Custom", selections: resolvedScope.selections },
      { _tag: "Custom", selections: automatic.selections },
    );
  }, [activeWorktreePath, refs.refs, resolvedScope]);
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
    <WorkspacePanel.Provider
      scopeKey={JSON.stringify([
        environmentId,
        logicalRepositoryId,
        activeWorktreePath,
      ])}
    >
      <CommitInspectionBridge
        client={inspectionClient}
        repositoryId={repositoryId}
        worktreePath={activeWorktreePath}
        connected={connected}
      >
        {(inspection) => (
          <WorkspacePanel.Group>
            <ResizablePanel
              defaultSize={branchesSidebarSize.default}
              groupResizeBehavior="preserve-pixel-size"
              id="branches"
              maxSize={branchesSidebarSize.max}
              minSize={branchesSidebarSize.min}
            >
              <BranchesSidebar
                activeWorktreePath={activeWorktreePath}
                focusRequest={localBranchesFocusRequest}
                onRetry={retryRefs}
                onSelectRef={selectRef}
                onToggleHistoryRef={toggleRef}
                selectedHistoryRefKeys={
                  resolvedScope?.selectedRefKeys ?? new Set<string>()
                }
                snapshot={refs}
              />
            </ResizablePanel>
            <ResizableHandle
              aria-label="Resize branches sidebar"
              className="z-10 bg-transparent after:w-2 focus-visible:ring-primary/40"
            />
            <WorkspacePanel.Main>
              {() => (
                <main
                  aria-label="Repository workspace"
                  className="h-full rounded-none bg-repository"
                >
                  <CommitGraph
                    ref={inspection.graphRef}
                    onOpenDetails={inspection.open}
                    onActiveCommitChange={inspection.select}
                    toolbarActions={<WorkspacePanel.Toggle />}
                    githubRepository={refs.refs?.githubRepository}
                    remoteProviders={refs.refs?.remoteProviders}
                    commandEnvironment={
                      environmentId === undefined ||
                      logicalRepositoryId === undefined ||
                      repositoryId === undefined
                        ? undefined
                        : {
                            environmentId,
                            logicalRepositoryId,
                            repositoryId,
                            activeWorktreePath,
                            ...(activeBranch === undefined
                              ? {}
                              : { activeBranch }),
                            connected,
                            capabilities: new Set(accessCapabilities),
                            freshnessReady: false,
                            operationState: "idle",
                          }
                    }
                    onRemoveHistoryRef={toggleRef}
                    onRevealHistoryRef={toggleRef}
                    onAddHistoryRef={() =>
                      setLocalBranchesFocusRequest((request) => request + 1)
                    }
                    onResetHistoryScope={
                      canResetHistoryScope
                        ? () => {
                            setHistoryScope(automaticHistoryScope);
                            if (
                              environmentId !== undefined &&
                              logicalRepositoryId !== undefined
                            ) {
                              filterStore.save(
                                environmentId,
                                logicalRepositoryId,
                                automaticHistoryScope,
                              );
                            }
                          }
                        : undefined
                    }
                    reader={historyReader}
                    repositoryName={repositoryName}
                    roots={resolvedScope?.roots}
                    scope={resolvedScope?.scope ?? automaticHistoryScope}
                    selections={resolvedScope?.selections ?? []}
                  />
                </main>
              )}
            </WorkspacePanel.Main>
            <WorkspacePanel.Pane
              contents={{
                commit: inspection.content,
                changes: (
                  <WorkingChanges
                    client={changesClient}
                    environmentId={environmentId}
                    repositoryId={repositoryId}
                    worktreePath={activeWorktreePath}
                    connected={connected}
                    writable={accessCapabilities.includes("repository.write")}
                    onCommitted={retryRefs}
                  />
                ),
              }}
            />
          </WorkspacePanel.Group>
        )}
      </CommitInspectionBridge>
    </WorkspacePanel.Provider>
  );
}
