import { type JSX, Suspense } from "react";
import { useCommitInspection } from "#web/app/workspace/use-commit-inspection.ts";
import { AuthorAvatars } from "#web/features/author-avatars/author-avatar.tsx";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar.tsx";
import { useCherryPick } from "#web/features/cherry-pick/cherry-pick-menu.tsx";
import { CommitGraph } from "#web/features/commit-graph/commit-graph.tsx";
import { automaticHistoryScope } from "#web/features/commit-graph/scope/history-scope.ts";
import { useHistoryScope } from "#web/features/commit-graph/scope/use-history-scope.ts";
import { useCompareActions } from "#web/features/comparison/comparison.ts";
import { useMergeActions } from "#web/features/merge/merge-actions.ts";
import { OperationRecoveryNotice } from "#web/features/operation-recovery/components/operation-recovery-toast.tsx";
import {
  CurrentPullRequest,
  usePullRequests,
} from "#web/features/pull-requests/pull-requests.tsx";
import { useRebaseActions } from "#web/features/rebase/rebase-actions.ts";
import type { RebasePlanTarget } from "#web/features/rebase/rebase-plan.ts";
import {
  DropConfirmation,
  useRewriteCommits,
} from "#web/features/rebase/rewrite-commits.tsx";
import { useScopedRepositoryRefs } from "#web/features/refs/repository-refs.ts";
import { RemoteSync } from "#web/features/remote-sync/remote-sync.tsx";
import { useCatalogRepository } from "#web/features/repository-catalog/use-repository-catalog.ts";
import { useRepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import {
  ResetConfirmation,
  useResetActions,
} from "#web/features/reset/reset-actions.tsx";
import {
  TerminalSplit,
  TerminalToggle,
} from "#web/features/terminal/terminal-panel.tsx";
import { useTerminals } from "#web/features/terminal/use-terminals.ts";
import { useUncommittedChanges } from "#web/features/working-changes/hooks/use-working-changes.ts";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import {
  comparePanel,
  fileHistoryPanel,
  rebasePanel,
  reflogPanel,
} from "#web/features/workspace-panel/workspace-panel-definitions.ts";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider.tsx";
import { WorktreeSwitcher } from "#web/features/worktrees/worktree-switcher.tsx";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";
import {
  type RepositoryScope,
  useRepositoryScope,
} from "#web/platform/query/repository-scope.tsx";

const noRefKeys: ReadonlySet<string> = new Set();

export function RepositoryWorkspace(): JSX.Element | null {
  const scope = useRepositoryScope();
  const { environmentId } = useEnvironment();
  if (scope === undefined || environmentId === undefined) return null;
  return (
    <RepositoryPanel
      key={JSON.stringify([
        environmentId,
        scope.repositoryId,
        scope.logicalRepositoryId,
      ])}
      environmentId={environmentId}
      scope={scope}
    />
  );
}

function RepositoryPanel({
  environmentId,
  scope,
}: {
  readonly environmentId: string;
  readonly scope: RepositoryScope;
}) {
  const { repositoryId, logicalRepositoryId, worktreePath } = scope;
  const panelScope = {
    environmentId,
    repositoryId,
    logicalRepositoryId,
    worktreePath,
  };
  return (
    <WorkspacePanel.Provider
      scope={panelScope}
      scopeKey={JSON.stringify([
        environmentId,
        logicalRepositoryId,
        worktreePath,
      ])}
    >
      <Workspace environmentId={environmentId} scope={scope} />
    </WorkspacePanel.Provider>
  );
}

function Workspace({
  environmentId,
  scope,
}: {
  readonly environmentId: string;
  readonly scope: RepositoryScope;
}) {
  const { worktreePath } = scope;
  const uncommitted = useUncommittedChanges();
  const history = useRepositoryHistory({
    environmentId,
    repositoryId: scope.repositoryId,
    logicalRepositoryId: scope.logicalRepositoryId,
  });
  const merge = useMergeActions(history);
  const { execute, store, state: panelState } = useWorkspacePanel();
  const terminals = useTerminals(environmentId, scope);
  const openRebasePlan = (input: RebasePlanTarget) => {
    execute({ type: "input", kind: "rebase", input });
    execute({ type: "open", kind: "rebase" });
  };
  const rebase = useRebaseActions(history, openRebasePlan);
  const cherryPick = useCherryPick(history);
  const rewrite = useRewriteCommits(history);
  const reset = useResetActions();
  const pullRequests = usePullRequests();
  const name = useCatalogRepository(scope.repositoryId)?.name ?? "Repository";
  const repositoryRefs = useScopedRepositoryRefs();
  const { refs } = repositoryRefs;
  const historyScope = useHistoryScope(environmentId, scope, repositoryRefs);
  const showReflog = (name: string) => {
    execute({
      type: "input",
      kind: "reflog",
      input: { _tag: "LocalBranch", name },
    });
    execute({ type: "open", kind: "reflog" });
  };
  const openStash = (oid: string) => {
    store.dispatch({
      type: "input",
      kind: "stash",
      input: { _tag: "Stash", oid },
    });
    store.dispatch({ type: "open", kind: "stash" });
  };
  const closeRebasePlan = () => execute({ type: "close", tab: "rebase" });
  const compare = useCompareActions(history, (input) =>
    execute({ type: "open", kind: "compare", input }),
  );
  const resolved = historyScope.resolvedScope;
  const {
    graphRef,
    open: openDetails,
    openMatch: openCodeMatch,
    select: selectCommit,
  } = useCommitInspection(scope.connected);
  return (
    <>
      <OperationRecoveryNotice key={worktreePath} repositoryName={name} />
      <ResetConfirmation reset={reset} />
      <DropConfirmation drop={rewrite} />
      <RemoteSync>
        {(syncActions) => (
          <AuthorAvatars repository={refs?.hostedRepository}>
            <WorkspacePanel.Group>
              <WorkspacePanel.Sidebar>
                <BranchesSidebar
                  history={history}
                  merge={merge}
                  pullRequests={pullRequests}
                  rebase={rebase}
                  reset={reset}
                  compare={compare}
                  onBranchRenamed={historyScope.renameBranch}
                  onShowReflog={showReflog}
                  onOpenStash={openStash}
                  onToggleHistoryRef={historyScope.toggleRef}
                  selectedHistoryRefKeys={
                    resolved?.selectedRefKeys ?? noRefKeys
                  }
                />
              </WorkspacePanel.Sidebar>
              <WorkspacePanel.Main>
                {() => (
                  <TerminalSplit terminals={terminals}>
                    <main
                      aria-label="Repository workspace"
                      className="h-full rounded-none bg-repository"
                    >
                      <CommitGraph
                        merge={merge}
                        rebase={rebase}
                        reset={reset}
                        compare={compare}
                        cherryPick={cherryPick}
                        rewrite={rewrite}
                        ref={graphRef}
                        onOpenDetails={openDetails}
                        onOpenCodeMatch={openCodeMatch}
                        onOpenChanges={() =>
                          execute({ type: "open", kind: "changes" })
                        }
                        onActiveCommitChange={selectCommit}
                        titleActions={
                          <>
                            <WorktreeSwitcher />
                            <CurrentPullRequest pullRequests={pullRequests} />
                          </>
                        }
                        toolbarActions={syncActions}
                        toolbarInset={!panelState.open}
                        remoteProviders={refs?.remoteProviders}
                        historyIdentity={{
                          environmentId,
                          repositoryId: scope.logicalRepositoryId,
                        }}
                        onRemoveHistoryRef={historyScope.toggleRef}
                        onRevealHistoryRef={historyScope.toggleRef}
                        onResetHistoryScope={historyScope.reset}
                        history={history}
                        repositoryName={name}
                        roots={resolved?.roots}
                        scope={resolved?.scope ?? automaticHistoryScope}
                        selections={resolved?.selections ?? []}
                      />
                    </main>
                  </TerminalSplit>
                )}
              </WorkspacePanel.Main>
              <WorkspacePanel.Pane
                contents={{
                  history: (
                    <Suspense fallback={null}>
                      <fileHistoryPanel.Content
                        onOpenDetails={openDetails}
                        onSelectCommit={(oid) =>
                          graphRef.current?.followOid(oid)
                        }
                      />
                    </Suspense>
                  ),
                  reflog: (
                    <Suspense fallback={null}>
                      <reflogPanel.Content
                        reset={reset}
                        onOpenDetails={openDetails}
                        onShowInGraph={async (oid) => {
                          await graphRef.current?.navigateToOid(oid);
                        }}
                      />
                    </Suspense>
                  ),
                  compare: (
                    <Suspense fallback={null}>
                      <comparePanel.Content history={history} />
                    </Suspense>
                  ),
                  rebase: (
                    <Suspense fallback={null}>
                      <rebasePanel.Content
                        history={history}
                        onClose={closeRebasePlan}
                      />
                    </Suspense>
                  ),
                }}
              />
            </WorkspacePanel.Group>
          </AuthorAvatars>
        )}
      </RemoteSync>
      <WorkspacePanel.Controls uncommitted={uncommitted !== undefined}>
        <TerminalToggle terminals={terminals} />
      </WorkspacePanel.Controls>
    </>
  );
}
