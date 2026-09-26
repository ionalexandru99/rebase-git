import {
  type ConflictFile,
  type ConflictList,
  type ConflictScope,
  RepositoryChangesHttpApi,
  RepositoryConflictsHttpApi,
  type WholeFileChoice,
} from "@rebase/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  type ChangesRequestFailure,
  describeChangesFailure,
} from "#web/features/working-changes/changes-messages";
import { conflictScope } from "#web/features/working-changes/conflicts/hooks/use-conflict-queries";
import { changesWriteScope } from "#web/features/working-changes/hooks/use-change-actions";
import { useEnvironment } from "#web/platform/query/environment-context";
import {
  environmentQueryKey,
  environmentRouteKey,
} from "#web/platform/query/environment-query";
import { useCommand } from "#web/platform/query/use-command";

export function useConflictActions(
  scope: ConflictScope,
  fileAt: (path: string) => ConflictFile | undefined,
) {
  const { write, reread } = useConflictCache();
  const options = {
    repository: scope,
    scope: changesWriteScope(scope),
    onSuccess: (list: ConflictList, command: ConflictScope) =>
      write(command, list),
    onError: (_failure: unknown, command: ConflictScope) => reread(command),
  };
  const stage = useCommand(RepositoryConflictsHttpApi.stage, options);
  const choose = useCommand(RepositoryConflictsHttpApi.choose, options);
  const mergeTool = useCommand(RepositoryConflictsHttpApi.mergeTool, options);
  const [pending, setPending] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const report = (failure: ChangesRequestFailure) =>
    setProblem(describeChangesFailure(failure));

  const resolve = (path: string, allowMarkers: boolean) => {
    const file = fileAt(path);
    if (file === undefined) return;
    setProblem(null);
    stage.mutate(
      { ...conflictScope(scope), path, revision: file.revision, allowMarkers },
      {
        onSuccess: () => setPending(null),
        onError: (failure) => {
          const markers =
            failure._tag === "EnvironmentHttpRejected" &&
            failure.failure.reason === "Markers";
          setPending(markers && !allowMarkers ? path : null);
          if (!markers || allowMarkers) report(failure);
        },
      },
    );
  };

  const chooseFile = (path: string, choice: WholeFileChoice) => {
    const file = fileAt(path);
    if (file === undefined) return;
    setProblem(null);
    setPending(null);
    choose.mutate(
      { ...conflictScope(scope), path, revision: file.revision, choice },
      { onError: report },
    );
  };

  const openMergeTool = (path: string) => {
    setProblem(null);
    mergeTool.mutate({ ...conflictScope(scope), path }, { onError: report });
  };

  return {
    pending,
    problem,
    busy: stage.isPending || choose.isPending || mergeTool.isPending,
    resolve,
    cancelResolve: () => setPending(null),
    choose: chooseFile,
    openMergeTool,
    clearProblem: () => setProblem(null),
  };
}

function useConflictCache() {
  const queryClient = useQueryClient();
  const { environmentId } = useEnvironment();
  const listKey = useCallback(
    (scope: ConflictScope) =>
      environmentQueryKey(
        environmentId,
        scope.repositoryId,
        RepositoryConflictsHttpApi.list,
        conflictScope(scope),
      ),
    [environmentId],
  );
  const write = useCallback(
    async (scope: ConflictScope, list: ConflictList) => {
      const queryKey = listKey(scope);
      await queryClient.cancelQueries({ queryKey });
      queryClient.setQueryData(queryKey, list);
      for (const route of [
        RepositoryChangesHttpApi.read,
        RepositoryConflictsHttpApi.document,
      ])
        void queryClient.invalidateQueries({
          queryKey: environmentRouteKey(
            environmentId,
            scope.repositoryId,
            route,
          ),
        });
    },
    [environmentId, listKey, queryClient],
  );
  const reread = useCallback(
    (scope: ConflictScope) =>
      queryClient.invalidateQueries({ queryKey: listKey(scope) }),
    [listKey, queryClient],
  );
  return { write, reread };
}
