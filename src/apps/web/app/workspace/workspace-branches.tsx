import type { WorkspaceHistoryScope } from "#web/app/workspace/use-workspace-history-scope";
import { ResizableHandle, ResizablePanel } from "#web/components/ui/resizable";
import type { BranchCreateRequest } from "#web/features/branch-management/hooks/use-create-branch-here";
import { BranchesSidebar } from "#web/features/branches-sidebar/branches-sidebar";
import type { RefCommandDefinition } from "#web/features/ref-commands/ref-command.contract";
import { useRefActivation } from "#web/features/repository-refs/hooks/use-ref-activation";
import type { RepositoryRefsRead } from "#web/features/repository-refs/hooks/use-repository-refs";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";

const noRefKeys: ReadonlySet<string> = new Set();

export function WorkspaceBranches({
  repositoryRefs,
  historyScope,
  createRequest,
  focusRequest,
  refCommands,
}: {
  readonly repositoryRefs: RepositoryRefsRead;
  readonly historyScope: WorkspaceHistoryScope;
  readonly createRequest: BranchCreateRequest | undefined;
  readonly focusRequest: number;
  readonly refCommands: readonly RefCommandDefinition[];
}) {
  const activation = useRefActivation(repositoryRefs);
  const worktreePath = useRepositoryScope()?.worktreePath ?? "";
  return (
    <>
      <ResizablePanel
        defaultSize="16.5rem"
        groupResizeBehavior="preserve-pixel-size"
        id="branches"
        maxSize="26rem"
        minSize="12rem"
      >
        <BranchesSidebar
          activation={activation}
          activeWorktreePath={worktreePath}
          createRequest={createRequest}
          focusRequest={focusRequest}
          onBranchRenamed={historyScope.renameBranch}
          onToggleHistoryRef={historyScope.toggleRef}
          refCommands={refCommands}
          repositoryRefs={repositoryRefs}
          selectedHistoryRefKeys={
            historyScope.resolvedScope?.selectedRefKeys ?? noRefKeys
          }
        />
      </ResizablePanel>
      <ResizableHandle
        aria-label="Resize branches sidebar"
        className="z-10 bg-transparent after:w-2 focus-visible:ring-primary/40"
      />
    </>
  );
}
