import { describe, expect, it } from 'vitest'
import { decidePushResponse, pushLabel } from '../action-runner-push'

describe('pushLabel', () => {
  it.each([
    [undefined, 'Pushed'],
    ['with-lease', 'Force pushed'],
    ['overwrite', 'Overwrote remote']
  ] as const)('labels %s pushes as %s', (force, label) => {
    expect(pushLabel(force)).toBe(label)
  })
})

describe('decidePushResponse', () => {
  it.each([
    [undefined, 'Pushed'],
    ['with-lease', 'Force pushed'],
    ['overwrite', 'Overwrote remote']
  ] as const)('refreshes and reports a successful %s push', (force, title) => {
    expect(decidePushResponse({ _tag: 'Ok' }, force)).toEqual({
      outcome: { kind: 'ok' },
      refreshCaches: true,
      notice: { kind: 'success', title }
    })
  })

  it('preserves rejection details for the force-push flow without notifying', () => {
    expect(
      decidePushResponse({
        _tag: 'PushRejected',
        reason: 'remote-moved',
        lostCommits: [{ sha: 'abc1234', subject: 'remote work' }],
        remoteSha: 'abc1234full'
      })
    ).toEqual({
      outcome: {
        kind: 'rejected',
        reason: 'remote-moved',
        lostCommits: [{ sha: 'abc1234', subject: 'remote work' }],
        remoteSha: 'abc1234full'
      },
      refreshCaches: false
    })
  })

  it('maps a closed repository to the repository notice channel', () => {
    expect(decidePushResponse({ _tag: 'RepoNotOpen' })).toEqual({
      outcome: { kind: 'error', message: 'Repository is not open' },
      refreshCaches: false,
      notice: { kind: 'error', title: 'Repository is not open' }
    })
  })

  it('maps Git failures to a force-specific Git notice without refreshing', () => {
    expect(
      decidePushResponse({ _tag: 'GitError', message: 'permission denied' }, 'with-lease')
    ).toEqual({
      outcome: { kind: 'error', message: 'permission denied' },
      refreshCaches: false,
      notice: {
        kind: 'git-error',
        title: 'Force pushed failed',
        message: 'permission denied'
      }
    })
  })
})
