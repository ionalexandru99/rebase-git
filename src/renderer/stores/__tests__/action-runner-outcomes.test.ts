import { PULL_REAPPLY_CONFLICTS_MESSAGE } from '@shared/git-constants'
import { describe, expect, it } from 'vitest'
import { decidePullResponse } from '../action-runner-outcomes'

describe('decidePullResponse', () => {
  it('maps success to a refresh and success notice', () => {
    expect(decidePullResponse({ _tag: 'Ok' })).toEqual({
      outcome: { kind: 'ok' },
      refreshCaches: true,
      notice: { kind: 'success', title: 'Pulled' }
    })
  })

  it('leaves divergence silent for the strategy chooser', () => {
    expect(decidePullResponse({ _tag: 'PullDiverged' })).toEqual({
      outcome: { kind: 'diverged' },
      refreshCaches: false
    })
  })

  it('maps ordinary conflicts to refreshed conflict state', () => {
    expect(decidePullResponse({ _tag: 'Conflict', message: 'CONFLICT in src/app.ts' })).toEqual({
      outcome: { kind: 'conflict' },
      refreshCaches: true,
      notice: {
        kind: 'warning',
        title: 'Pull hit conflicts',
        description: 'Resolve the conflicted files, then continue or abort.'
      }
    })
  })

  it('explains the retained stash for reapply conflicts', () => {
    expect(
      decidePullResponse({ _tag: 'Conflict', message: PULL_REAPPLY_CONFLICTS_MESSAGE })
    ).toEqual({
      outcome: { kind: 'conflict' },
      refreshCaches: true,
      notice: {
        kind: 'warning',
        title: 'Pulled, but your uncommitted changes conflicted',
        description:
          'Resolve the conflicted files, then drop the kept stash — your original changes are safe in it.'
      }
    })
  })

  it('includes the active operation in blocked-pull guidance', () => {
    expect(decidePullResponse({ _tag: 'OperationInProgress', operation: 'merge' })).toEqual({
      outcome: { kind: 'error', message: 'A merge is already in progress' },
      refreshCaches: false,
      notice: {
        kind: 'warning',
        title: 'Another Git operation is in progress',
        description: 'Finish or abort the in-progress merge first.'
      }
    })
  })

  it('maps repository and Git failures to their notification channels', () => {
    expect(decidePullResponse({ _tag: 'RepoNotOpen' })).toEqual({
      outcome: { kind: 'error', message: 'Repository is not open' },
      refreshCaches: false,
      notice: { kind: 'error', title: 'Repository is not open' }
    })
    expect(decidePullResponse({ _tag: 'GitError', message: 'not fast-forward' })).toEqual({
      outcome: { kind: 'error', message: 'not fast-forward' },
      refreshCaches: false,
      notice: { kind: 'git-error', title: 'Pull failed', message: 'not fast-forward' }
    })
  })
})
