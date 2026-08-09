import { describe, expect, it, vi } from 'vitest'
import { createRepoSessionOwnership } from '../repo-session-ownership'

describe('repo session ownership', () => {
  it('allocates increasing owner identifiers', () => {
    const ownership = createRepoSessionOwnership()

    expect(ownership.nextOwner()).toBe(1)
    expect(ownership.nextOwner()).toBe(2)
  })

  it('resolves known aliases to their canonical repository path', () => {
    const ownership = createRepoSessionOwnership()

    ownership.rememberCanonicalPath('/repos/link', '/repos/project')

    expect(ownership.resolvePath('/repos/link')).toBe('/repos/project')
    expect(ownership.resolvePath('/repos/project')).toBe('/repos/project')
    expect(ownership.resolvePath('/repos/other')).toBe('/repos/other')
  })

  it('counts overlapping opens by canonical identity', () => {
    const ownership = createRepoSessionOwnership()
    ownership.rememberCanonicalPath('/repos/link', '/repos/project')

    const firstIdentity = ownership.beginOpen('/repos/link')
    const secondIdentity = ownership.beginOpen('/repos/project')

    expect(firstIdentity).toBe('["local","/repos/project"]')
    expect(secondIdentity).toBe('["local","/repos/project"]')
    expect(ownership.hasActiveOpen('/repos/project')).toBe(true)

    ownership.endOpen(firstIdentity)
    expect(ownership.hasActiveOpen('/repos/project')).toBe(true)

    ownership.endOpen(secondIdentity)
    expect(ownership.hasActiveOpen('/repos/project')).toBe(false)
  })

  it('tracks and releases the current pending close', () => {
    const ownership = createRepoSessionOwnership()
    const first = setTimeout(() => {}, 10)
    const replacement = setTimeout(() => {}, 10)

    ownership.trackPendingClose('/repo', first)
    expect(ownership.matchesPendingClose('/repo', first)).toBe(true)

    ownership.trackPendingClose('/repo', replacement)
    expect(ownership.matchesPendingClose('/repo', first)).toBe(false)
    expect(ownership.matchesPendingClose('/repo', replacement)).toBe(true)

    ownership.releasePendingClose('/repo')
    expect(ownership.matchesPendingClose('/repo', replacement)).toBe(false)
    clearTimeout(first)
    clearTimeout(replacement)
  })

  it('cancels a tracked close once and forgets it', () => {
    const cancelTimer = vi.fn()
    const ownership = createRepoSessionOwnership(cancelTimer)
    const pendingClose = setTimeout(() => {}, 10)

    ownership.trackPendingClose('/repo', pendingClose)
    ownership.cancelPendingClose('/repo')
    ownership.cancelPendingClose('/repo')

    expect(cancelTimer).toHaveBeenCalledOnce()
    expect(cancelTimer).toHaveBeenCalledWith(pendingClose)
    expect(ownership.matchesPendingClose('/repo', pendingClose)).toBe(false)
    clearTimeout(pendingClose)
  })
})
