import {
  type ChangesScope,
  type ReadChangeDiff,
  RepositoryChangesHttpApi,
  type ViewedChange,
} from "@rebase/contracts";
import { environmentQueryKey } from "#web/platform/query/environment-query";

export function changesScope({
  repositoryId,
  worktreePath,
  amend,
}: ChangesScope): ChangesScope {
  return { repositoryId, worktreePath, amend };
}

export function changeDiffInput(
  scope: ChangesScope,
  { section, path }: ViewedChange,
): ReadChangeDiff {
  return { ...changesScope(scope), section, path };
}

export function changesKey(
  environmentId: string | undefined,
  scope: ChangesScope,
) {
  return environmentQueryKey(
    environmentId,
    scope.repositoryId,
    RepositoryChangesHttpApi.read,
    changesScope(scope),
  );
}

export function changeDiffKey(
  environmentId: string | undefined,
  scope: ChangesScope,
  viewed: ViewedChange,
  revision: string,
) {
  return environmentQueryKey(
    environmentId,
    scope.repositoryId,
    RepositoryChangesHttpApi.diff,
    changeDiffInput(scope, viewed),
    revision,
  );
}
