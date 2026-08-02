export interface ActionResponse {
  _tag: string
  message?: string
  operation?: string
}

export interface ActionDecisionOptions {
  silentSuccess?: boolean
  failureLabel?: string
  conflictDescription?: string
}

import type { ActionRunnerNotice } from './action-runner-notices'

export interface ActionResponseDecision {
  succeeded: boolean
  refreshCaches: boolean
  notice?: ActionRunnerNotice
}

export function decideActionResponse(
  response: ActionResponse,
  label: string,
  options?: ActionDecisionOptions
): ActionResponseDecision {
  const failedTitle = `${options?.failureLabel ?? label} failed`
  switch (response._tag) {
    case 'Ok':
      return {
        succeeded: true,
        refreshCaches: true,
        notice: options?.silentSuccess ? undefined : { kind: 'success', title: label }
      }
    case 'Conflict':
      return {
        succeeded: false,
        refreshCaches: true,
        notice: {
          kind: 'warning',
          title: `${label} hit conflicts`,
          description:
            options?.conflictDescription ?? 'Resolve the conflicted files, then commit or abort.'
        }
      }
    case 'OperationInProgress':
      return {
        succeeded: false,
        refreshCaches: false,
        notice: {
          kind: 'warning',
          title: 'Another Git operation is in progress',
          description: `Finish or abort the in-progress ${response.operation} first.`
        }
      }
    case 'GitError':
      return {
        succeeded: false,
        refreshCaches: false,
        notice: { kind: 'git-error', title: failedTitle, message: response.message ?? '' }
      }
    case 'RepoNotOpen':
      return {
        succeeded: false,
        refreshCaches: false,
        notice: { kind: 'error', title: 'Repository is not open' }
      }
    default:
      return {
        succeeded: false,
        refreshCaches: false,
        notice: {
          kind: 'error',
          title: failedTitle,
          description: `Unexpected response: ${response._tag}`
        }
      }
  }
}
