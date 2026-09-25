import { useMemo } from "react";
import type { LocalEnvironmentSession } from "#web/app/environment/local-environment-session.contract";
import type { BranchActions } from "#web/features/branches-sidebar/index";

export function useBranchActions({
  activeWorktreePath,
  selectedRepositoryId,
  session,
}: {
  readonly activeWorktreePath: string;
  readonly selectedRepositoryId: string | undefined;
  readonly session: LocalEnvironmentSession;
}): BranchActions | undefined {
  return useMemo(() => {
    if (selectedRepositoryId === undefined) return undefined;
    const scope = {
      repositoryId: selectedRepositoryId,
      worktreePath: activeWorktreePath,
    };
    return {
      create: async ({ checkout, ...branch }) => {
        await session.branches.create({ ...scope, ...branch });
        if (checkout)
          await session.repositoryRefs
            .checkout(activeWorktreePath, {
              _tag: "LocalBranch",
              name: branch.name,
            })
            .catch(() => undefined);
      },
      delete: (branch) => session.branches.delete({ ...scope, ...branch }),
      rename: async (branch) => {
        await session.branches.rename({ ...scope, ...branch });
      },
      setUpstream: async (branch) => {
        await session.branches.setUpstream({ ...scope, ...branch });
      },
    };
  }, [activeWorktreePath, selectedRepositoryId, session]);
}
