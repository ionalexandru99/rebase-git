import type {
  EnvironmentAccessCapability,
  RepositoryRefTarget,
} from "@rebase/contracts";
import type { JSX } from "react";
import { useCallback, useMemo, useState } from "react";
import { useHistoryRefRefresh } from "#web/app/workspace/use-history-ref-refresh";
import { BranchesSidebar } from "#web/features/branches-sidebar/index";
import type { GraphCommandEnvironment } from "#web/features/commit-commands/index";
import type {
  CommitGraphHistory,
  HistoryScope,
} from "#web/features/commit-graph/index";
import {
  automaticHistoryScope,
  CommitGraph,
  createBrowserHistoryFilterStore,
  historyScopesEqual,
  resolveHistoryScope,
  toggleHistoryRef,
} from "#web/features/commit-graph/index";
import type { RepositoryRefsSnapshot } from "#web/features/repository-refs/repository-refs-controller.contract";
import { useCachedRepositoryRefs } from "#web/features/repository-refs/use-cached-repository-refs";
import { CommitInspectionBridge } from "#web-ui/app/workspace/commit-inspection-bridge";
import {
  ResizableHandle,
  ResizablePanel,
} from "#web-ui/components/ui/resizable";
import { WorkspacePanel } from "#web-ui/features/workspace-panel/index";

const noAccessCapabilities: readonly EnvironmentAccessCapability[] = [];
const branchesSidebarSize = {
  default: "16.5rem",
  max: "26rem",
  min: "12rem",
} as const;

export function RepositoryWorkspace({
  accessCapabilities = noAccessCapabilities,
  connected = false,
  activeWorktreePath,
  environmentId,
  history,
  logicalRepositoryId: catalogLogicalRepositoryId,
  refs,
  repositoryId,
  repositoryName,
  retryRefs,
  selectRef,
}: {
  readonly accessCapabilities?: readonly EnvironmentAccessCapability[];
  readonly connected?: boolean;
  readonly activeWorktreePath: string;
  readonly environmentId: string | undefined;
  readonly history: CommitGraphHistory | undefined;
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
      accessCapabilities={accessCapabilities}
      connected={connected}
      activeWorktreePath={activeWorktreePath}
      environmentId={environmentId}
      history={history}
      key={`${environmentId ?? ""}\0${repositoryId ?? ""}\0${logicalRepositoryId ?? ""}`}
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
  accessCapabilities,
  connected,
  activeWorktreePath,
  environmentId,
  history,
  logicalRepositoryId,
  refs,
  refsRestored,
  repositoryId,
  repositoryName,
  retryRefs,
  selectRef,
}: {
  readonly accessCapabilities: readonly EnvironmentAccessCapability[];
  readonly connected: boolean;
  readonly activeWorktreePath: string;
  readonly environmentId: string | undefined;
  readonly history: CommitGraphHistory | undefined;
  readonly logicalRepositoryId: string | undefined;
  readonly refs: RepositoryRefsSnapshot;
  readonly refsRestored: boolean;
  readonly repositoryId: string | undefined;
  readonly repositoryName: string;
  readonly retryRefs: () => void;
  readonly selectRef: (target: RepositoryRefTarget) => void;
}): JSX.Element {
  const [localBranchesFocusRequest, setLocalBranchesFocusRequest] = useState(0);
  const panelScope = useMemo(
    () =>
      environmentId && repositoryId && logicalRepositoryId
        ? {
            environmentId,
            repositoryId,
            logicalRepositoryId,
            worktreePath: activeWorktreePath,
          }
        : undefined,
    [environmentId, repositoryId, logicalRepositoryId, activeWorktreePath],
  );
  useHistoryRefRefresh(history?.reader, connected, retryRefs);
  const activeBranch = refs.refs?.worktrees.find(
    ({ path }) => path === activeWorktreePath,
  )?.head.branch;
  const filterStore = useMemo(() => createBrowserHistoryFilterStore(), []);
  const commandEnvironment = useMemo<GraphCommandEnvironment | undefined>(
    () =>
      environmentId === undefined ||
      logicalRepositoryId === undefined ||
      repositoryId === undefined
        ? undefined
        : {
            environmentId,
            logicalRepositoryId,
            repositoryId,
            activeWorktreePath,
            ...(activeBranch === undefined ? {} : { activeBranch }),
            connected,
            capabilities: new Set(accessCapabilities),
            freshnessReady: false,
            operationState: "idle",
          },
    [
      environmentId,
      logicalRepositoryId,
      repositoryId,
      activeWorktreePath,
      activeBranch,
      connected,
      accessCapabilities,
    ],
  );
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
  const changeHistoryScope = useCallback(
    (next: HistoryScope) => {
      setHistoryScope(next);
      if (environmentId !== undefined && logicalRepositoryId !== undefined) {
        filterStore.save(environmentId, logicalRepositoryId, next);
      }
    },
    [environmentId, filterStore, logicalRepositoryId],
  );
  const toggleRef = useCallback(
    (target: RepositoryRefTarget) => {
      if (refs.refs === undefined) return;
      changeHistoryScope(
        resolveHistoryScope(
          toggleHistoryRef(historyScope, target, refs.refs, activeWorktreePath),
          refs.refs,
          activeWorktreePath,
        ).scope,
      );
    },
    [activeWorktreePath, changeHistoryScope, historyScope, refs.refs],
  );

  return (
    <WorkspacePanel.Provider
      scope={panelScope}
      scopeKey={JSON.stringify([
        environmentId,
        logicalRepositoryId,
        activeWorktreePath,
      ])}
    >
      <CommitInspectionBridge connected={connected}>
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
                    commandEnvironment={commandEnvironment}
                    onRemoveHistoryRef={toggleRef}
                    onRevealHistoryRef={toggleRef}
                    onAddHistoryRef={() =>
                      setLocalBranchesFocusRequest((request) => request + 1)
                    }
                    onResetHistoryScope={
                      canResetHistoryScope
                        ? () => changeHistoryScope(automaticHistoryScope)
                        : undefined
                    }
                    history={history}
                    repositoryName={repositoryName}
                    roots={resolvedScope?.roots}
                    scope={resolvedScope?.scope ?? automaticHistoryScope}
                    selections={resolvedScope?.selections ?? []}
                  />
                </main>
              )}
            </WorkspacePanel.Main>
            <WorkspacePanel.Pane />
          </WorkspacePanel.Group>
        )}
      </CommitInspectionBridge>
    </WorkspacePanel.Provider>
  );
}
