import type {
  EnvironmentAccessCapability,
  RepositoryRefTarget,
} from "@rebase/contracts";
import type { JSX } from "react";
import { useMemo, useState } from "react";
import { useHistoryRefRefresh } from "#web/app/workspace/use-history-ref-refresh";
import { useWorkspaceHistoryScope } from "#web/app/workspace/use-workspace-history-scope";
import { BranchesSidebar } from "#web/features/branches-sidebar/index";
import type { GraphCommandEnvironment } from "#web/features/commit-commands/index";
import type { CommitGraphHistory } from "#web/features/commit-graph/index";
import {
  automaticHistoryScope,
  CommitGraph,
} from "#web/features/commit-graph/index";
import {
  OperationRecovery,
  useOperationCommandState,
} from "#web/features/operation-recovery/index";
import { RepositoryPull } from "#web/features/repository-pull/index";
import {
  RepositoryPush,
  resolvePushTarget,
} from "#web/features/repository-push/index";
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

interface RepositoryWorkspaceProps {
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
}

export function RepositoryWorkspace(
  props: RepositoryWorkspaceProps,
): JSX.Element {
  const { environmentId, refs, repositoryId } = props;
  const logicalRepositoryId =
    props.logicalRepositoryId ?? refs.refs?.logicalRepositoryId ?? repositoryId;
  const cachedRefs = useCachedRepositoryRefs(
    environmentId,
    logicalRepositoryId,
    repositoryId,
    refs,
  );
  return (
    <RepositoryWorkspaceContent
      {...props}
      key={`${environmentId ?? ""}\0${repositoryId ?? ""}\0${logicalRepositoryId ?? ""}`}
      logicalRepositoryId={logicalRepositoryId}
      refs={cachedRefs.snapshot}
      refsRestored={cachedRefs.restored}
    />
  );
}

function RepositoryWorkspaceContent({
  accessCapabilities = noAccessCapabilities,
  connected = false,
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
}: RepositoryWorkspaceProps & { readonly refsRestored: boolean }): JSX.Element {
  const [localBranchesFocusRequest, setLocalBranchesFocusRequest] = useState(0);
  const operationState = useOperationCommandState();
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
  const writable = accessCapabilities.includes("repository.write");
  const incoming =
    refs.refs?.branches.find(({ name }) => name === activeBranch)?.upstream
      ?.behind ?? 0;
  const pushTarget = useMemo(
    () => resolvePushTarget(refs.refs, activeBranch),
    [refs.refs, activeBranch],
  );
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
            operationState,
          },
    [
      environmentId,
      logicalRepositoryId,
      repositoryId,
      activeWorktreePath,
      activeBranch,
      connected,
      accessCapabilities,
      operationState,
    ],
  );
  const historyScope = useWorkspaceHistoryScope({
    environmentId,
    logicalRepositoryId,
    activeWorktreePath,
    refs: refs.refs,
    refsRestored,
  });
  const resolvedScope = historyScope.resolvedScope;

  return (
    <WorkspacePanel.Provider
      scope={panelScope}
      scopeKey={JSON.stringify([
        environmentId,
        logicalRepositoryId,
        activeWorktreePath,
      ])}
    >
      <RepositoryPull.Provider reader={history?.reader} incoming={incoming}>
        <OperationRecovery.Notice repositoryName={repositoryName} />
        <RepositoryPull.Notice />
        <RepositoryPush.Notice />
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
                  onToggleHistoryRef={historyScope.toggleRef}
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
                      toolbarActions={
                        <>
                          <RepositoryPush.Button
                            target={pushTarget}
                            disabled={
                              !connected ||
                              !writable ||
                              operationState === "busy"
                            }
                          />
                          <WorkspacePanel.Toggle />
                        </>
                      }
                      githubRepository={refs.refs?.githubRepository}
                      remoteProviders={refs.refs?.remoteProviders}
                      commandEnvironment={commandEnvironment}
                      onRemoveHistoryRef={historyScope.toggleRef}
                      onRevealHistoryRef={historyScope.toggleRef}
                      onAddHistoryRef={() =>
                        setLocalBranchesFocusRequest((request) => request + 1)
                      }
                      onResetHistoryScope={historyScope.reset}
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
      </RepositoryPull.Provider>
    </WorkspacePanel.Provider>
  );
}
