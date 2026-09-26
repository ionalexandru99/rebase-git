import { type JSX, useState } from "react";
import { useOpenedHistory } from "#web/app/shell/opened-history-context";
import { CommitInspectionBridge } from "#web/app/workspace/commit-inspection-bridge";
import { RepositoryPanelProvider } from "#web/app/workspace/repository-panel-provider";
import { useHistoryRefRefresh } from "#web/app/workspace/use-history-ref-refresh";
import { useWorkspaceHistoryScope } from "#web/app/workspace/use-workspace-history-scope";
import { WorkspaceBranches } from "#web/app/workspace/workspace-branches";
import { WorkspaceGraph } from "#web/app/workspace/workspace-graph";
import { useCreateBranchHere } from "#web/features/branch-management/hooks/use-create-branch-here";
import { OperationRecoveryNotice } from "#web/features/operation-recovery/components/operation-recovery-notice";
import { useCatalogRepository } from "#web/features/repository-catalog/hooks/use-repository-catalog";
import { PullButton } from "#web/features/repository-pull/components/pull-button";
import { PullNotice } from "#web/features/repository-pull/components/pull-notice";
import { usePull } from "#web/features/repository-pull/hooks/use-pull";
import { PushButton } from "#web/features/repository-push/components/push-button";
import { PushNotice } from "#web/features/repository-push/components/push-notice";
import { usePush } from "#web/features/repository-push/hooks/use-push";
import { resolvePushTarget } from "#web/features/repository-push/resolve-push-target";
import { activeHead } from "#web/features/repository-refs/activate-repository-ref";
import { useRepositoryRefs } from "#web/features/repository-refs/hooks/use-repository-refs";
import {
  type RepositoryScope,
  useRepositoryScope,
} from "#web/features/repository-scope/repository-scope-provider";
import { WorkspacePanel } from "#web/features/workspace-panel/workspace-panel";
import { useEnvironment } from "#web/platform/query/environment-context";

export function RepositoryWorkspace(): JSX.Element | null {
  const scope = useRepositoryScope();
  const { environmentId } = useEnvironment();
  if (scope === undefined || environmentId === undefined) return null;
  const { repositoryId, logicalRepositoryId } = scope;
  return (
    <RepositoryPanelProvider
      key={JSON.stringify([environmentId, repositoryId, logicalRepositoryId])}
      environmentId={environmentId}
      scope={scope}
    >
      <Workspace environmentId={environmentId} scope={scope} />
    </RepositoryPanelProvider>
  );
}

function Workspace({
  environmentId,
  scope,
}: {
  readonly environmentId: string;
  readonly scope: RepositoryScope;
}) {
  const [branchFocusRequest, setBranchFocusRequest] = useState(0);
  const history = useOpenedHistory();
  const name = useCatalogRepository(scope.repositoryId)?.name ?? "Repository";
  const repositoryRefs = useRepositoryRefs(
    scope.repositoryId,
    scope.logicalRepositoryId,
  );
  const { refs } = repositoryRefs;
  const branchCreation = useCreateBranchHere();
  const historyScope = useWorkspaceHistoryScope(
    environmentId,
    scope,
    repositoryRefs,
  );
  const push = usePush();
  const pull = usePull(history?.reader);
  useHistoryRefRefresh(history?.reader, scope.connected, repositoryRefs.retry);
  const activeBranch = refs && activeHead(refs, scope.worktreePath)?.branch;
  const incoming = refs?.branches.find(({ name }) => name === activeBranch)
    ?.upstream?.behind;
  return (
    <>
      <OperationRecoveryNotice key={scope.worktreePath} repositoryName={name} />
      <PullNotice pull={pull} />
      <PushNotice push={push} />
      <CommitInspectionBridge connected={scope.connected}>
        {(inspection) => (
          <WorkspacePanel.Group>
            <WorkspaceBranches
              repositoryRefs={repositoryRefs}
              historyScope={historyScope}
              createRequest={branchCreation.request}
              focusRequest={branchFocusRequest}
              refCommands={pull.commands}
            />
            <WorkspacePanel.Main>
              {() => (
                <WorkspaceGraph
                  scope={scope}
                  inspection={inspection}
                  historyScope={historyScope}
                  commands={branchCreation.commands}
                  onAddHistoryRef={() =>
                    setBranchFocusRequest((request) => request + 1)
                  }
                  toolbarActions={
                    <>
                      <PullButton
                        pull={pull}
                        activeBranch={activeBranch}
                        incoming={incoming ?? 0}
                      />
                      <PushButton
                        push={push}
                        target={resolvePushTarget(refs, activeBranch)}
                      />
                      <WorkspacePanel.Toggle />
                    </>
                  }
                />
              )}
            </WorkspacePanel.Main>
            <WorkspacePanel.Pane />
          </WorkspacePanel.Group>
        )}
      </CommitInspectionBridge>
    </>
  );
}
