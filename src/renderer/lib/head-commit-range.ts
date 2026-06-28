import { GIT_EMPTY_TREE_OID } from '@shared/git-constants'

// The commit range that isolates HEAD's own changes: against its first parent normally, or against the
// empty tree for a root commit (no parent). Merge commits (parentCount > 1) are not inspected here.
export function buildHeadCommitRange(parentCount: number): string {
  return parentCount === 0 ? `${GIT_EMPTY_TREE_OID}..HEAD` : 'HEAD~1..HEAD'
}
