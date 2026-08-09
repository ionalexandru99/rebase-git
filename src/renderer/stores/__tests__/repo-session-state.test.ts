import { describe, expect, it } from 'vitest'
import { toRepoRef } from '@/features/repository-identity'
import {
  clearRepoSessionError,
  completeRepoOpening,
  displayedRepoSessionError,
  failRepoOpening,
  initialRepoSessionState,
  resetRepoSession,
  setRepoSessionError,
  startRepoOpening
} from '../repo-session-state'

describe('repo session state', () => {
  it('starts a new open generation and clears errors', () => {
    const previous = setRepoSessionError(initialRepoSessionState(), 'status', 'stale status', 1)

    expect(startRepoOpening(previous, 4)).toEqual({
      ...previous,
      opening: true,
      errors: {},
      openGeneration: 4
    })
  })

  it('records an open failure as the only session error', () => {
    const previous = startRepoOpening(initialRepoSessionState(), 2)

    expect(failRepoOpening(previous, 'Not a git repository', 7)).toMatchObject({
      opening: false,
      errors: { session: { message: 'Not a git repository', sequence: 7 } }
    })
  })

  it('records canonical repository data after opening', () => {
    const previous = startRepoOpening(initialRepoSessionState(), 3)

    expect(
      completeRepoOpening(
        previous,
        {
          path: '/canonical/repo',
          remotes: { origin: 'git@example.com:repo.git' },
          defaultBranch: 'main'
        },
        toRepoRef('/canonical/repo'),
        3
      )
    ).toEqual({
      repoRef: toRepoRef('/canonical/repo'),
      repoPath: '/canonical/repo',
      remotes: { origin: 'git@example.com:repo.git' },
      defaultBranch: 'main',
      opening: false,
      errors: {},
      openGeneration: 3,
      resetEpoch: 0
    })
  })

  it('resets repository data and optionally advances the reset epoch', () => {
    const opened = completeRepoOpening(
      initialRepoSessionState(2, 5),
      { path: '/repo', remotes: {}, defaultBranch: 'main' },
      toRepoRef('/repo'),
      2
    )

    expect(resetRepoSession(opened, 3)).toEqual(initialRepoSessionState(3, 5))
    expect(resetRepoSession(opened, 4, true)).toEqual(initialRepoSessionState(4, 6))
  })

  it('displays the newest error across concern sources', () => {
    let state = setRepoSessionError(initialRepoSessionState(), 'mutation', 'mutation failed', 2)
    state = setRepoSessionError(state, 'status', 'status failed', 4)
    state = setRepoSessionError(state, 'history', 'history failed', 3)

    expect(displayedRepoSessionError(state.errors)?.message).toBe('status failed')
  })

  it('uses concern priority when errors have the same sequence', () => {
    expect(
      displayedRepoSessionError({
        refs: { message: 'refs failed', sequence: 3 },
        session: { message: 'session failed', sequence: 3 },
        mutation: { message: 'mutation failed', sequence: 3 }
      })?.message
    ).toBe('session failed')
  })

  it('clears one concern without changing the others', () => {
    let state = setRepoSessionError(initialRepoSessionState(), 'status', 'status failed', 1)
    state = setRepoSessionError(state, 'mutation', 'mutation failed', 2)

    const cleared = clearRepoSessionError(state, 'mutation')

    expect(cleared.errors).toEqual({
      status: { message: 'status failed', sequence: 1 }
    })
    expect(clearRepoSessionError(cleared, 'mutation')).toBe(cleared)
  })
})
