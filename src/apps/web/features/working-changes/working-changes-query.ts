import type {
  ChangesScope,
  ReadChangeDiff,
  ViewedChange,
} from "@rebase/contracts";

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
