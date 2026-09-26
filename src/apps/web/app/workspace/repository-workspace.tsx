import type { JSX } from "react";
import { useMemo, useState } from "react";
import { CommitInspectionBridge } from "#web/app/workspace/commit-inspection-bridge";
import { useHistoryRefRefresh } from "#web/app/workspace/use-history-ref-refresh";
import { useWorkspaceHistoryScope } from "#web/app/workspace/use-workspace-history-scope";
import { ResizableHandle, ResizablePanel } from "#web/components/ui/resizable";
import { useCreateBranchHere } from "#web/features/branch-management/hooks/use-create-branch-here";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar";
import { GraphCommands } from "#web/features/commit-commands/graph-command-slot";
import { CommitGraph } from "#web/features/commit-graph/commit-graph";
import type { CommitGraphHistory } from "#web/features/commit-graph/commit-graph.contract";
import { automaticHistoryScope } from "#web/features/commit-graph/history-scope.contract";
import { OperationRecoveryNotice } from "#web/features/operation-recovery/components/operation-recovery-notice";
import { RefCommands } from "#web/features/ref-commands/ref-commands";
import { PullButton } from "#web/features/repository-pull/components/pull-button";
import { PullNotice } from "#web/features/repository-pull/components/pull-notice";
import { usePull } from "#web/features/repository-pull/hooks/use-pull";
import { PushButton } from "#web/features/repository-push/components/push-button";
import { PushNotice } from "#web/features/repository-push/components/push-notice";
import { usePush } from "#web/features/repository-push/hooks/use-push";
import { resolvePushTarget } from "#web/features/repository-push/resolve-push-target";
import { useRefActivation } from "#web/features/repository-refs/hooks/use-ref-activation";
import { useRepositoryRefs } from "#web/features/repository-refs/hooks/use-repository-refs";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel";

const branchesSidebarSize = {
  default: "16.5rem",
  max: "26rem",
  min: "12rem",
} as const;

interface RepositoryWorkspaceProps {
  readonly activeWorktreePath: string;
  readonly environmentId: string | undefined;
  readonly history: CommitGraphHistory | undefined;
  readonly logicalRepositoryId: string | undefined;
  readonly repositoryId: string | undefined;
  readonly repositoryName: string;
  readonly switchWorktree: (worktreePath: string) => void;
}

export function RepositoryWorkspace(
  props: RepositoryWorkspaceProps,
): JSX.Element {
  const { environmentId, logicalRepositoryId, repositoryId } = props;
  return (
    <RepositoryWorkspaceContent
      {...props}
      key={`${environmentId ?? ""}\0${repositoryId ?? ""}\0${logicalRepositoryId ?? ""}`}
    />
  );
}

function RepositoryWorkspaceContent({
  activeWorktreePath,
  environmentId,
  history,
  logicalRepositoryId,
  repositoryId,
  repositoryName,
  switchWorktree,
}: RepositoryWorkspaceProps): JSX.Element {
  const [localBranchesFocusRequest, setLocalBranchesFocusRequest] = useState(0);
  const repositoryRefs = useRepositoryRefs(repositoryId, logicalRepositoryId);
  const refs = repositoryRefs.refs;
  const activation = useRefActivation(repositoryRefs, switchWorktree);
  const branchCreation = useCreateBranchHere();
  const connected = useRepositoryScope()?.connected ?? false;
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
  useHistoryRefRefresh(history?.reader, connected, repositoryRefs.retry);
  const activeBranch = refs?.worktrees.find(
    ({ path }) => path === activeWorktreePath,
  )?.head.branch;
  const incoming =
    refs?.branches.find(({ name }) => name === activeBranch)?.upstream
      ?.behind ?? 0;
  const pushTarget = useMemo(
    () => resolvePushTarget(refs, activeBranch),
    [refs, activeBranch],
  );
  const historyScope = useWorkspaceHistoryScope({
    environmentId,
    logicalRepositoryId,
    activeWorktreePath,
    refs,
    refsRestored: repositoryRefs.restored,
  });
  const resolvedScope = historyScope.resolvedScope;
  const push = usePush();
  const pull = usePull(history?.reader);

  return (
    <WorkspacePanel.Provider
      scope={panelScope}
      scopeKey={JSON.stringify([
        environmentId,
        logicalRepositoryId,
        activeWorktreePath,
      ])}
    >
      <GraphCommands.Contribute commands={branchCreation.commands}>
        <RefCommands.Contribute commands={pull.commands}>
          <OperationRecoveryNotice
            key={activeWorktreePath}
            repositoryName={repositoryName}
          />
          <PullNotice pull={pull} />
          <PushNotice push={push} />
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
                    activation={activation}
                    activeWorktreePath={activeWorktreePath}
                    createRequest={branchCreation.request}
                    focusRequest={localBranchesFocusRequest}
                    onBranchRenamed={historyScope.renameBranch}
                    onToggleHistoryRef={historyScope.toggleRef}
                    repositoryRefs={repositoryRefs}
                    selectedHistoryRefKeys={
                      resolvedScope?.selectedRefKeys ?? new Set<string>()
                    }
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
                            <PullButton
                              pull={pull}
                              activeBranch={activeBranch}
                              incoming={incoming}
                            />
                            <PushButton push={push} target={pushTarget} />
                            <WorkspacePanel.Toggle />
                          </>
                        }
                        githubRepository={refs?.githubRepository}
                        remoteProviders={refs?.remoteProviders}
                        historyIdentity={
                          environmentId === undefined ||
                          logicalRepositoryId === undefined
                            ? undefined
                            : {
                                environmentId,
                                repositoryId: logicalRepositoryId,
                              }
                        }
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
        </RefCommands.Contribute>
      </GraphCommands.Contribute>
    </WorkspacePanel.Provider>
  );
}
