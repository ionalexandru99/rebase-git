import type { RepositoryRefTarget } from "@rebase/contracts";
import { useCallback, useRef } from "react";
import { resolveRefActivation } from "#web/features/repository-refs/activate-repository-ref";
import { useCheckout } from "#web/features/repository-refs/hooks/use-checkout";
import type { RepositoryRefsRead } from "#web/features/repository-refs/hooks/use-repository-refs";
import { describeCheckoutFailure } from "#web/features/repository-refs/refs-messages";
import { useRepositoryScope } from "#web/features/repository-scope/index";

export interface RefActivation {
  readonly select: (target: RepositoryRefTarget) => void;
  readonly checkingOut: boolean;
  readonly error: string | null;
}

export function useRefActivation(
  { refs, restored }: RepositoryRefsRead,
  switchWorktree: (worktreePath: string) => void,
): RefActivation {
  const scope = useRepositoryScope();
  const checkout = useCheckout();
  const { mutate } = checkout;
  const checkingOut = useRef(false);
  const select = useCallback(
    (target: RepositoryRefTarget) => {
      if (
        scope === undefined ||
        refs === undefined ||
        restored ||
        checkingOut.current
      )
        return;
      const activation = resolveRefActivation(refs, scope.worktreePath, target);
      if (activation._tag === "SwitchWorktree")
        switchWorktree(activation.worktreePath);
      else if (activation._tag === "Checkout") {
        checkingOut.current = true;
        mutate(
          {
            repositoryId: scope.repositoryId,
            worktreePath: scope.worktreePath,
            target: activation.target,
          },
          {
            onSettled: () => {
              checkingOut.current = false;
            },
          },
        );
      }
    },
    [mutate, refs, restored, scope, switchWorktree],
  );
  return {
    select,
    checkingOut: checkout.isPending,
    error: checkout.isError ? describeCheckoutFailure(checkout.error) : null,
  };
}
