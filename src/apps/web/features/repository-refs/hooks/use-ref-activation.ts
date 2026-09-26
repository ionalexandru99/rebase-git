import type { RepositoryRefs, RepositoryRefTarget } from "@rebase/contracts";
import { useCallback } from "react";
import { resolveRefActivation } from "#web/features/repository-refs/activate-repository-ref";
import { useCheckout } from "#web/features/repository-refs/hooks/use-checkout";
import { describeCheckoutFailure } from "#web/features/repository-refs/refs-messages";
import { useRepositoryScope } from "#web/features/repository-scope/index";

export interface RefActivation {
  readonly select: (target: RepositoryRefTarget) => void;
  readonly checkingOut: boolean;
  readonly error: string | null;
}

export function useRefActivation(
  refs: RepositoryRefs | undefined,
  switchWorktree: (worktreePath: string) => void,
): RefActivation {
  const scope = useRepositoryScope();
  const checkout = useCheckout();
  const { isPending, mutate } = checkout;
  const select = useCallback(
    (target: RepositoryRefTarget) => {
      if (scope === undefined || refs === undefined || isPending) return;
      const activation = resolveRefActivation(refs, scope.worktreePath, target);
      if (activation._tag === "SwitchWorktree")
        switchWorktree(activation.worktreePath);
      else if (activation._tag === "Checkout")
        mutate({
          repositoryId: scope.repositoryId,
          worktreePath: scope.worktreePath,
          target: activation.target,
        });
    },
    [isPending, mutate, refs, scope, switchWorktree],
  );
  return {
    select,
    checkingOut: isPending,
    error: checkout.isError ? describeCheckoutFailure(checkout.error) : null,
  };
}
