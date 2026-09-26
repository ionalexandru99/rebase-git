import { RepositoryRefsHttpApi } from "@rebase/contracts";
import { applyRepositoryCheckout } from "#web/features/repository-refs/apply-repository-checkout";
import { useApplyToRefs } from "#web/features/repository-refs/hooks/use-apply-to-refs";
import { useRepositoryScope } from "#web/features/repository-scope/index";
import { useCommand } from "#web/platform/query/use-command";

export function useCheckout() {
  const applyToRefs = useApplyToRefs();
  return useCommand(RepositoryRefsHttpApi.checkout, {
    repository: useRepositoryScope(),
    onSuccess: (checkedOut) =>
      applyToRefs((refs) => applyRepositoryCheckout(refs, checkedOut)),
  });
}
