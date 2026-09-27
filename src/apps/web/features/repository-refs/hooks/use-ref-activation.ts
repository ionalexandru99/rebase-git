import {
  RepositoryRefsHttpApi,
  type RepositoryRefTarget,
} from "@rebase/contracts";
import { useCallback, useRef } from "react";
import { resolveRefActivation } from "#web/features/repository-refs/activate-repository-ref";
import type { RepositoryRefsRead } from "#web/features/repository-refs/hooks/use-repository-refs";
import { useRepositoryScope } from "#web/platform/query/repository-scope";
import { describeFailure } from "#web/platform/query/request-failure";
import { useCommand } from "#web/platform/query/use-command";

export interface RefActivation {
  readonly select: (target: RepositoryRefTarget) => void;
  readonly checkingOut: boolean;
  readonly error: string | null;
}

export function useRefActivation({
  refs,
  restored,
}: RepositoryRefsRead): RefActivation {
  const scope = useRepositoryScope();
  const checkout = useCommand(RepositoryRefsHttpApi.checkout);
  const { run } = checkout;
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
        scope.switchWorktree(activation.worktreePath);
      else if (activation._tag === "Checkout") {
        checkingOut.current = true;
        void run({ target: activation.target }).finally(() => {
          checkingOut.current = false;
        });
      }
    },
    [run, refs, restored, scope],
  );
  return {
    select,
    checkingOut: checkout.running,
    error:
      checkout.failure === undefined
        ? null
        : describeFailure(checkout.failure, {
            CheckoutRejected: ({ reason }) =>
              reason === "StashFailed"
                ? "Local changes could not be stashed."
                : "Local changes would be overwritten.",
          }),
  };
}
