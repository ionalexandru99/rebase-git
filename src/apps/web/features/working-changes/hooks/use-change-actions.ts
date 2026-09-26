import {
  type ChangesScope,
  type ChangesWritten,
  RepositoryChangesHttpApi,
  type ViewedChange,
} from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import {
  changeDiffKey,
  changesKey,
} from "#web/features/working-changes/working-changes-query";
import { type CommandScope, useCommand } from "#web/platform/query/use-command";
import { useEnvironment } from "#web-ui/platform/query/environment-context";

type WrittenScope = ChangesScope & { readonly viewed?: ViewedChange };

export function useChangeActions(repository: CommandScope) {
  const { write, reread } = useChangesCache();
  const mutate = useCommand(RepositoryChangesHttpApi.mutate, {
    repository,
    onSuccess: (written, command) => write(command, written),
    onError: (_error, command) => reread(command),
  });
  const commit = useCommand(RepositoryChangesHttpApi.commit, {
    repository,
    onSuccess: (written, command) =>
      write({ ...command, amend: false }, written),
    onError: (_error, command) => reread(command),
  });
  return { mutate, commit, busy: mutate.isPending || commit.isPending };
}

function useChangesCache() {
  const queryClient = useQueryClient();
  const { environmentId } = useEnvironment();
  const write = useCallback(
    async (scope: WrittenScope, written: ChangesWritten) => {
      const queryKey = changesKey(environmentId, scope);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, written.changes);
      if (scope.viewed !== undefined && written.diff !== null)
        queryClient.setQueryData(
          changeDiffKey(
            environmentId,
            scope,
            scope.viewed,
            written.changes.revision,
          ),
          written.diff,
        );
    },
    [environmentId, queryClient],
  );
  const reread = useCallback(
    (scope: ChangesScope) =>
      queryClient.invalidateQueries({
        queryKey: changesKey(environmentId, scope),
      }),
    [environmentId, queryClient],
  );
  return { write, reread };
}
