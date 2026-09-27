import {
  type RepositoryBranchesOperationFailure,
  type RepositoryRejected,
  repositoryRejected,
} from "@rebase/contracts";
import {
  type GitFailed,
  isGitRejection,
} from "#server/adapters/local-git/git-commands";

export function branchWriteFailed(
  error: GitFailed,
  name: string,
): RepositoryBranchesOperationFailure | RepositoryRejected {
  if (!isGitRejection(error))
    return repositoryRejected("GitFailed", error.detail);
  const conflict = /'refs\/heads\/([^']+)' exists; cannot create/.exec(
    error.detail,
  )?.[1];
  if (conflict !== undefined) return { _tag: "BranchExists", name: conflict };
  if (/already exists/i.test(error.detail))
    return { _tag: "BranchExists", name };
  const holder = /used by worktree at '([^']+)'/.exec(error.detail)?.[1];
  if (holder !== undefined)
    return { _tag: "BranchCheckedOutElsewhere", name, worktreePath: holder };
  if (/not a valid branch name/i.test(error.detail))
    return { _tag: "InvalidBranchName", name };
  return repositoryRejected("GitFailed", error.detail);
}
