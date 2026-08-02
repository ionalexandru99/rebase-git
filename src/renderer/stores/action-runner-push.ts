import type { Rpc } from '@effect/rpc'
import type { Push } from '@shared/rpc'
import type { RpcResult } from '@shared/rpc-result'

export type PushResponse = RpcResult<
  Rpc.SuccessExitEncoded<typeof Push>,
  Rpc.ErrorExitEncoded<typeof Push>
>

type PushRejectedResponse = Extract<PushResponse, { _tag: 'PushRejected' }>

export type PushForce = NonNullable<Rpc.Payload<typeof Push>['force']>
export type PushRejectionReason = PushRejectedResponse['reason']

export type PushOutcome =
  | { kind: 'ok' }
  | {
      kind: 'rejected'
      reason: PushRejectionReason
      lostCommits: PushRejectedResponse['lostCommits']
      remoteSha?: PushRejectedResponse['remoteSha']
    }
  | { kind: 'error'; message: string }

export type PushNotice =
  | { kind: 'success'; title: string }
  | { kind: 'error'; title: string }
  | { kind: 'git-error'; title: string; message: string }

export interface PushResponseDecision {
  outcome: PushOutcome
  refreshCaches: boolean
  notice?: PushNotice
}

export function pushLabel(force?: PushForce): string {
  if (force === 'overwrite') {
    return 'Overwrote remote'
  }
  if (force === 'with-lease') {
    return 'Force pushed'
  }
  return 'Pushed'
}

export function decidePushResponse(
  response: PushResponse,
  force?: PushForce
): PushResponseDecision {
  const label = pushLabel(force)
  switch (response._tag) {
    case 'Ok':
      return {
        outcome: { kind: 'ok' },
        refreshCaches: true,
        notice: { kind: 'success', title: label }
      }
    case 'PushRejected':
      return {
        outcome: {
          kind: 'rejected',
          reason: response.reason,
          lostCommits: response.lostCommits,
          remoteSha: response.remoteSha
        },
        refreshCaches: false
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
        notice: { kind: 'git-error', title: 'Push failed', message: response.message }
      }
  }
}
