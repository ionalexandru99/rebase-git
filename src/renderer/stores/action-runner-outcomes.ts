import type { Rpc } from '@effect/rpc'
import { PULL_REAPPLY_CONFLICTS_MESSAGE } from '@shared/git-constants'
import type { Pull } from '@shared/rpc'
import type { RpcResult } from '@shared/rpc-result'

export type PullResponse = RpcResult<
  Rpc.SuccessExitEncoded<typeof Pull>,
  Rpc.ErrorExitEncoded<typeof Pull>
>

export type PullOutcome =
  | { kind: 'ok' }
  | { kind: 'diverged' }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string }

export type PullNotice =
  | { kind: 'success'; title: string }
  | { kind: 'warning'; title: string; description: string }
  | { kind: 'error'; title: string }
  | { kind: 'git-error'; title: string; message: string }

export interface PullResponseDecision {
  outcome: PullOutcome
  refreshCaches: boolean
  notice?: PullNotice
}

export function decidePullResponse(response: PullResponse): PullResponseDecision {
  switch (response._tag) {
    case 'Ok':
      return {
        outcome: { kind: 'ok' },
        refreshCaches: true,
        notice: { kind: 'success', title: 'Pulled' }
      }
    case 'PullDiverged':
      return { outcome: { kind: 'diverged' }, refreshCaches: false }
    case 'Conflict':
      return {
        outcome: { kind: 'conflict' },
        refreshCaches: true,
        notice:
          response.message === PULL_REAPPLY_CONFLICTS_MESSAGE
            ? {
                kind: 'warning',
                title: 'Pulled, but your uncommitted changes conflicted',
                description:
                  'Resolve the conflicted files, then drop the kept stash — your original changes are safe in it.'
              }
            : {
                kind: 'warning',
                title: 'Pull hit conflicts',
                description: 'Resolve the conflicted files, then continue or abort.'
              }
      }
    case 'OperationInProgress':
      return {
        outcome: { kind: 'error', message: `A ${response.operation} is already in progress` },
        refreshCaches: false,
        notice: {
          kind: 'warning',
          title: 'Another Git operation is in progress',
          description: `Finish or abort the in-progress ${response.operation} first.`
        }
      }
    case 'RepoNotOpen':
      return {
        outcome: { kind: 'error', message: 'Repository is not open' },
        refreshCaches: false,
        notice: { kind: 'error', title: 'Repository is not open' }
      }
    case 'GitError':
      return {
        outcome: { kind: 'error', message: response.message },
        refreshCaches: false,
        notice: { kind: 'git-error', title: 'Pull failed', message: response.message }
      }
  }
}
