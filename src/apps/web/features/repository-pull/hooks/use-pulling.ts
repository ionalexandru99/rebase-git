import { RepositoryPullHttpApi } from "@rebase/contracts";
import { useIsMutating } from "@tanstack/react-query";
import { commandKey } from "#web/platform/query/use-command";

export function usePulling() {
  return (
    useIsMutating({ mutationKey: commandKey(RepositoryPullHttpApi.pull) }) > 0
  );
}
