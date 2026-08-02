import { describe, expect, it } from 'vitest'
import { decideActionResponse } from '../action-runner-decision'

describe('decideActionResponse', () => {
  it('refreshes and reports success', () => {
    expect(decideActionResponse({ _tag: 'Ok' }, 'Stashed')).toEqual({
      succeeded: true,
      refreshCaches: true,
      notice: { kind: 'success', title: 'Stashed' }
    })
  })

  it('can keep success silent without skipping refreshes', () => {
    expect(decideActionResponse({ _tag: 'Ok' }, 'Fetched', { silentSuccess: true })).toEqual({
      succeeded: true,
      refreshCaches: true
    })
  })

  it('refreshes conflicts and preserves custom recovery guidance', () => {
    expect(
      decideActionResponse({ _tag: 'Conflict' }, 'Cherry-pick', {
        conflictDescription: 'Resolve the files, then continue or abort.'
      })
    ).toEqual({
      succeeded: false,
      refreshCaches: true,
      notice: {
        kind: 'warning',
        title: 'Cherry-pick hit conflicts',
        description: 'Resolve the files, then continue or abort.'
      }
    })
  })

  it('explains which existing operation blocks the action', () => {
    expect(
      decideActionResponse({ _tag: 'OperationInProgress', operation: 'rebase' }, 'Cherry-pick')
    ).toEqual({
      succeeded: false,
      refreshCaches: false,
      notice: {
        kind: 'warning',
        title: 'Another Git operation is in progress',
        description: 'Finish or abort the in-progress rebase first.'
      }
    })
  })

  it('uses the failure label for Git failures', () => {
    expect(
      decideActionResponse({ _tag: 'GitError', message: 'index locked' }, 'Discarded', {
        failureLabel: 'Discard'
      })
    ).toEqual({
      succeeded: false,
      refreshCaches: false,
      notice: { kind: 'git-error', title: 'Discard failed', message: 'index locked' }
    })
  })

  it('maps a closed repository to its shared error notice', () => {
    expect(decideActionResponse({ _tag: 'RepoNotOpen' }, 'Stashed')).toEqual({
      succeeded: false,
      refreshCaches: false,
      notice: { kind: 'error', title: 'Repository is not open' }
    })
  })

  it('reports unknown responses with the action failure title', () => {
    expect(decideActionResponse({ _tag: 'FutureResponse' }, 'Stashed')).toEqual({
      succeeded: false,
      refreshCaches: false,
      notice: {
        kind: 'error',
        title: 'Stashed failed',
        description: 'Unexpected response: FutureResponse'
      }
    })
  })
})
