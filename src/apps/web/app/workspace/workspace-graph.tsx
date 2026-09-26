import type { ReactNode } from "react";
import { useOpenedHistory } from "#web/app/shell/opened-history-context";
import type { InspectionGraphActions } from "#web/app/workspace/commit-inspection-bridge";
import type { WorkspaceHistoryScope } from "#web/app/workspace/use-workspace-history-scope";
import type { GraphCommandDefinition } from "#web/features/commit-commands/graph-command.contract";
import { CommitGraph } from "#web/features/commit-graph/commit-graph";
import { automaticHistoryScope } from "#web/features/commit-graph/history-scope.contract";
import { useCatalogRepository } from "#web/features/repository-catalog/hooks/use-repository-catalog";
import { useRepositoryRefs } from "#web/features/repository-refs/hooks/use-repository-refs";
import type { RepositoryScope } from "#web/features/repository-scope/repository-scope-provider";
import { useEnvironment } from "#web/platform/query/environment-context";

export function WorkspaceGraph({
  scope,
  inspection,
  historyScope,
  commands,
  toolbarActions,
  onAddHistoryRef,
}: {
  readonly scope: RepositoryScope;
  readonly inspection: InspectionGraphActions;
  readonly historyScope: WorkspaceHistoryScope;
  readonly commands: readonly GraphCommandDefinition[];
  readonly toolbarActions: ReactNode;
  readonly onAddHistoryRef: () => void;
}) {
  const { environmentId } = useEnvironment();
  const history = useOpenedHistory();
  const name = useCatalogRepository(scope.repositoryId)?.name ?? "Repository";
  const { refs } = useRepositoryRefs(
    scope.repositoryId,
    scope.logicalRepositoryId,
  );
  const resolved = historyScope.resolvedScope;
  return (
    <main
      aria-label="Repository workspace"
      className="h-full rounded-none bg-repository"
    >
      <CommitGraph
        ref={inspection.graphRef}
        commands={commands}
        onOpenDetails={inspection.open}
        onActiveCommitChange={inspection.select}
        toolbarActions={toolbarActions}
        githubRepository={refs?.githubRepository}
        remoteProviders={refs?.remoteProviders}
        historyIdentity={
          environmentId === undefined
            ? undefined
            : { environmentId, repositoryId: scope.logicalRepositoryId }
        }
        onRemoveHistoryRef={historyScope.toggleRef}
        onRevealHistoryRef={historyScope.toggleRef}
        onAddHistoryRef={onAddHistoryRef}
        onResetHistoryScope={historyScope.reset}
        history={history}
        repositoryName={name}
        roots={resolved?.roots}
        scope={resolved?.scope ?? automaticHistoryScope}
        selections={resolved?.selections ?? []}
      />
    </main>
  );
}
