import { type JSX, Suspense, useCallback, useMemo } from "react";
import { CommitInspectionBridge } from "#web/app/workspace/commit-inspection-bridge.tsx";
import {
  ResizableHandle,
  ResizablePanel,
} from "#web/components/ui/resizable.tsx";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar.tsx";
import { useCherryPick } from "#web/features/cherry-pick/cherry-pick-menu.tsx";
import { CommitGraph } from "#web/features/commit-graph/commit-graph.tsx";
import { automaticHistoryScope } from "#web/features/commit-graph/scope/history-scope.ts";
import { useHistoryScope } from "#web/features/commit-graph/scope/use-history-scope.ts";
import { useMergeActions } from "#web/features/merge/merge-actions.ts";
import { OperationRecoveryNotice } from "#web/features/operation-recovery/components/operation-recovery-toast.tsx";
import { useRebaseActions } from "#web/features/rebase/rebase-actions.ts";
import type { RebasePlanTarget } from "#web/features/rebase/rebase-plan.ts";
import { requestRefIntent } from "#web/features/refs/ref-actions.ts";
import { useScopedRepositoryRefs } from "#web/features/refs/repository-refs.ts";
import { RemoteSync } from "#web/features/remote-sync/remote-sync.tsx";
import { useCatalogRepository } from "#web/features/repository-catalog/use-repository-catalog.ts";
import { useRepositoryHistory } from "#web/features/repository-history/repository-history.ts";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel.tsx";
import {
  rebasePanel,
  reflogPanel,
} from "#web/features/workspace-panel/workspace-panel-definitions.ts";
import { useWorkspacePanel } from "#web/features/workspace-panel/workspace-panel-provider.tsx";
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
  const panelScope = useMemo(
    () => ({ environmentId, repositoryId, logicalRepositoryId, worktreePath }),
    [environmentId, repositoryId, logicalRepositoryId, worktreePath],
  );
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
  const history = useRepositoryHistory({
    environmentId,
    repositoryId: scope.repositoryId,
    logicalRepositoryId: scope.logicalRepositoryId,
  });
  const merge = useMergeActions(history);
  const panel = useWorkspacePanel();
  const openRebasePlan = useCallback(
    (input: RebasePlanTarget) => {
      panel.execute({ type: "input", kind: "rebase", input });
      panel.execute({ type: "open", kind: "rebase" });
    },
    [panel.execute],
  );
  const rebase = useRebaseActions(history, openRebasePlan);
  const cherryPick = useCherryPick(history);
  const name = useCatalogRepository(scope.repositoryId)?.name ?? "Repository";
  const repositoryRefs = useScopedRepositoryRefs();
  const { refs } = repositoryRefs;
  const historyScope = useHistoryScope(environmentId, scope, repositoryRefs);
  const showReflog = useCallback(
    (name: string) => {
      panel.execute({
        type: "input",
        kind: "reflog",
        input: { _tag: "LocalBranch", name },
      });
      panel.execute({ type: "open", kind: "reflog" });
    },
    [panel.execute],
  );
  const closeRebasePlan = useCallback(
    () => panel.execute({ type: "close", kind: "rebase" }),
    [panel.execute],
  );
  const resolved = historyScope.resolvedScope;
  return (
    <>
      <OperationRecoveryNotice key={worktreePath} repositoryName={name} />
      <RemoteSync>
        {(syncActions) => (
          <CommitInspectionBridge connected={scope.connected}>
            {(inspection) => (
              <WorkspacePanel.Group>
                <ResizablePanel
                  defaultSize="16.5rem"
                  groupResizeBehavior="preserve-pixel-size"
                  id="branches"
                  maxSize="26rem"
                  minSize="12rem"
                >
                  <BranchesSidebar
                    merge={merge}
                    rebase={rebase}
                    onBranchRenamed={historyScope.renameBranch}
                    onShowReflog={showReflog}
                    onToggleHistoryRef={historyScope.toggleRef}
                    selectedHistoryRefKeys={
                      resolved?.selectedRefKeys ?? noRefKeys
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
                        merge={merge}
                        rebase={rebase}
                        cherryPick={cherryPick}
                        ref={inspection.graphRef}
                        onOpenDetails={inspection.open}
                        onActiveCommitChange={inspection.select}
                        toolbarActions={
                          <>
                            {syncActions}
                            <WorkspacePanel.Toggle />
                          </>
                        }
                        githubRepository={refs?.githubRepository}
                        remoteProviders={refs?.remoteProviders}
                        historyIdentity={{
                          environmentId,
                          repositoryId: scope.logicalRepositoryId,
                        }}
                        onRemoveHistoryRef={historyScope.toggleRef}
                        onRevealHistoryRef={historyScope.toggleRef}
                        onAddHistoryRef={() =>
                          requestRefIntent({ _tag: "FocusRefs" })
                        }
                        onResetHistoryScope={historyScope.reset}
                        history={history}
                        repositoryName={name}
                        roots={resolved?.roots}
                        scope={resolved?.scope ?? automaticHistoryScope}
                        selections={resolved?.selections ?? []}
                      />
                    </main>
                  )}
                </WorkspacePanel.Main>
                <WorkspacePanel.Pane
                  contents={{
                    reflog: (
                      <Suspense fallback={null}>
                        <reflogPanel.Content
                          onOpenDetails={inspection.open}
                          onShowInGraph={async (oid) => {
                            await inspection.graphRef.current?.navigateToOid(
                              oid,
                            );
                          }}
                        />
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
            )}
          </CommitInspectionBridge>
        )}
      </RemoteSync>
    </>
  );
}
