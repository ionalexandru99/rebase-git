import {
  type RepositoryCheckoutFailure,
  type RepositoryRejected,
  repositoryRejected,
} from "@rebase/contracts";
import type { RepositoryGitError } from "#server/domain/repository-git.contract";
import { isGitRejection } from "#server/repository/access/index";

export function checkoutFailure(
  error: RepositoryGitError,
  targetName: string,
): RepositoryCheckoutFailure | RepositoryRejected {
  if (!isGitRejection(error))
    return repositoryRejected("GitFailed", error.detail);
  const elsewhere =
    /already (?:checked out|used by worktree) at '([^']+)'/.exec(error.detail);
  if (elsewhere?.[1] !== undefined) {
    return {
      _tag: "BranchCheckedOutElsewhere",
      name: targetName,
      worktreePath: elsewhere[1],
    };
  }
  if (
    /did not match any file\(s\) known to git|invalid reference|is not a commit and a branch/i.test(
      error.detail,
    )
  ) {
    return { _tag: "RefMissing", name: targetName };
  }
  if (/would be overwritten by checkout/i.test(error.detail)) {
    return {
      _tag: "CheckoutRejected",
      detail: error.detail,
      reason: "LocalChanges",
    };
  }
  return repositoryRejected("GitFailed", error.detail);
}
