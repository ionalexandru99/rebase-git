import { RepositoryPullHttpApi } from "@rebase/contracts";
import { useIsMutating } from "@tanstack/react-query";
import { useRepositoryScope } from "#web/features/repository-scope/repository-scope-provider";
import { commandKey } from "#web/platform/query/use-command";

export function usePulling() {
  const scope = useRepositoryScope();
  const running = useIsMutating({
    mutationKey: commandKey(
      RepositoryPullHttpApi.pull,
      scope === undefined ? undefined : { repositoryId: scope.repositoryId },
    ),
  });
  return scope !== undefined && running > 0;
}
