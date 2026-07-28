import type { ConflictOperationKind, OperationState } from '@shared/schemas/git'

export interface OperationSummary {
  kind: ConflictOperationKind
  /** Names the operation with the real refs behind index stages :2 and :3. */
  title: string
  /** `done/total` for sequences that report it, otherwise null. */
  progress: string | null
  noun: string
  /** A merge is finished from the commit box, so only the other kinds get a Continue button. */
  canContinue: boolean
  continueText: string
  abortText: string
  confirmTitle: string
  confirmMessage: string
}

const OPERATION_NOUNS: Record<ConflictOperationKind, string> = {
  merge: 'merge',
  'rebase-merge': 'rebase',
  'rebase-apply': 'rebase',
  am: 'patch series',
  'cherry-pick': 'cherry-pick',
  revert: 'revert'
}

function operationTitle(operation: OperationState): string {
  switch (operation.kind) {
    case 'merge':
      return `Merging ${operation.theirsLabel} into ${operation.oursLabel}`
    case 'rebase-merge':
    case 'rebase-apply':
      return `Rebasing ${operation.theirsLabel} onto ${operation.oursLabel}`
    case 'am':
      return 'Applying patches'
    case 'cherry-pick':
      return `Cherry-picking ${operation.theirsLabel}`
    case 'revert':
      return `Reverting ${operation.theirsLabel}`
  }
}

export function summarizeOperation(operation: OperationState): OperationSummary {
  const noun = OPERATION_NOUNS[operation.kind]
  const hasProgress = operation.done !== undefined && operation.total !== undefined
  return {
    kind: operation.kind,
    title: operationTitle(operation),
    progress: hasProgress ? `${operation.done}/${operation.total}` : null,
    noun,
    canContinue: operation.kind !== 'merge',
    continueText: `Continue ${noun}`,
    abortText: `Abort ${noun}`,
    confirmTitle: `Abort this ${noun}?`,
    confirmMessage: `The ${noun} stops and the repository returns to the state it was in before the ${noun} started. Conflicts you have already resolved are lost.`
  }
}

export function operationGuidance(summary: OperationSummary, conflictCount: number): string {
  if (conflictCount === 0) {
    // A patch `git am` could not apply leaves no unmerged index entries at all, so an empty conflict
    // list here does not mean the work is done — `am --continue` would refuse with "No changes".
    if (summary.kind === 'am') {
      return `A patch that fails to apply leaves nothing marked conflicted. Edit the affected files and stage them, then continue the ${summary.noun}.`
    }
    return summary.canContinue
      ? `All conflicts are resolved — continue to finish the ${summary.noun}.`
      : 'All conflicts are resolved — commit below to finish the merge.'
  }
  const files = `${conflictCount} conflicted file${conflictCount === 1 ? '' : 's'} left`
  return summary.canContinue
    ? `${files}. Resolve and stage every file before you continue.`
    : `${files}. Resolve and stage every file, then commit below to finish the merge.`
}
